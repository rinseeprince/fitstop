/**
 * Teardown.
 *
 * Deliberately does NOT rely on `ON DELETE CASCADE`, for two reasons:
 *
 *  1. **Correctness is auditable.** A cascade deletes whatever the FK graph
 *     happens to say today; an explicit reverse-order walk deletes exactly the
 *     tables this script wrote, and can assert what it touched.
 *  2. **Cascade is O(n²) here.** 17 foreign keys in this schema have no
 *     supporting index (`attention_dismissals.client_id` and
 *     `coach_client_views.client_id` among them), so a parent delete triggers a
 *     sequential scan of each child per row.
 *
 * Every delete is keyed on the primary key range of the seed UUID namespace,
 * which is an index range scan by definition — "indexed columns only" holds
 * without adding an index or touching the schema.
 *
 * The safety property that matters: teardown snapshots the count of rows OUTSIDE
 * the namespace per table before and after, and aborts if any of them changed.
 * The owner's real account lives in this database, so "we only deleted our own
 * rows" is asserted, not assumed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SEED_ID_LO, SEED_ID_HI, isSeedEmail } from "./ids";
import { countRows, countTotalRows } from "./db";

/**
 * Exact reverse of the write order in generate.ts. Children before parents at
 * every step, so no row is ever orphaned mid-teardown even if it aborts.
 */
export const TEARDOWN_ORDER: readonly string[] = [
  "check_ins",
  "client_metric_entries",
  "body_metrics",
  "set_logs",
  "exercise_logs",
  "session_logs",
  "daily_habit_logs",
  "nutrition_logs",
  "wellness_logs",
  "daily_logs",
  "nutrition_events",
  "nutrition_plan_daily_targets",
  "nutrition_plans",
  "training_events",
  "training_exercises",
  "training_sessions",
  "training_plans",
  "daily_habits",
  "client_goals",
  "client_invitations",
  "clients",
  "coaches",
];

const DELETE_BATCH = 500;

/**
 * Delete the namespace's rows from one table, in batches.
 *
 * Pages ids out of the PK range and deletes them by `in (...)` rather than
 * issuing one statement against the whole range: at 775k rows a single DELETE is
 * one very long transaction holding locks the whole time.
 */
export async function deleteSeedRows(
  db: SupabaseClient,
  table: string
): Promise<number> {
  let removed = 0;
  for (let guard = 0; ; guard++) {
    // Ordered, so the page is a CONTIGUOUS id range and its last id is the range
    // ceiling. Deleting by `.in("id", [...500 uuids])` instead puts ~20KB of
    // percent-encoded uuids in the query string and PostgREST answers "URI too
    // long" — at which point teardown aborts having deleted nothing.
    const { data, error } = await db
      .from(table)
      .select("id")
      .gte("id", SEED_ID_LO)
      .lt("id", SEED_ID_HI)
      .order("id", { ascending: true })
      .limit(DELETE_BATCH);
    if (error) throw new Error(`teardown select ${table}: ${error.message}`);
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) return removed;

    const lastId = rows[rows.length - 1].id;
    const del = await db
      .from(table)
      .delete()
      .gte("id", SEED_ID_LO)
      .lte("id", lastId)
      .select("id");
    if (del.error) throw new Error(`teardown delete ${table}: ${del.error.message}`);

    const deleted = del.data?.length ?? 0;
    // A page that selects rows but deletes none would spin forever. Reachable
    // if a constraint silently blocks the delete, so fail loudly instead.
    if (deleted === 0) {
      throw new Error(
        `teardown delete ${table}: selected ${rows.length} seeded rows but deleted 0. ` +
          "Something is blocking the delete (an unindexed FK from a table not in TEARDOWN_ORDER, " +
          "or an ON DELETE NO ACTION child such as content_assignments). Aborting rather than looping."
      );
    }
    removed += deleted;

    if (guard > 100_000) {
      throw new Error(`teardown delete ${table}: exceeded 100k batches; aborting as a runaway guard.`);
    }
  }
}

export type TeardownReport = {
  perTable: { table: string; removed: number; unmarkedBefore: number; unmarkedAfter: number }[];
  authUsersRemoved: number;
  /** profiles rows the auth cascade took. Asserted to equal authUsersRemoved. */
  profilesRemoved: number;
};

/**
 * Tables that hold no seeded rows but that a cascade could reach.
 *
 * Deleting an `auth.users` row cascades into `public` — and every seeded coach
 * and client is an FK parent of tables this script never writes
 * (`coach_client_views`, `attention_dismissals`, `client_notes`,
 * `content_assignments`, ...). Those are empty for a seeded principal on a
 * clean run, but a persona login used between seed and teardown populates them,
 * and `content_assignments -> coaches` is ON DELETE NO ACTION, so it would
 * block the coaches delete outright rather than cascade.
 *
 * Guard 4 only ever covered TEARDOWN_ORDER, and only before the auth phase.
 * These are checked too, and re-checked after the auth users go.
 */
const CASCADE_WITNESS_TABLES: readonly string[] = [
  // NOTE: `profiles` is deliberately NOT here. handle_new_user writes one
  // profiles row per seeded auth user, so it IS part of the seed's footprint
  // and is EXPECTED to shrink when those users go. It gets its own exact-delta
  // assertion below rather than a "must not move" one.
  "coach_client_views",
  "attention_dismissals",
  "client_notes",
  "client_intake",
  "content_assignments",
  "check_in_reminders",
  "nutrition_weekly_summaries",
  "training_logs",
];

/**
 * Remove every seeded row, asserting no collateral damage.
 *
 * Throws before deleting anything if a table's unmarked count cannot be read,
 * and throws immediately after a table if its unmarked count moved.
 */
export async function teardown(
  db: SupabaseClient,
  onProgress: (table: string, removed: number) => void
): Promise<TeardownReport> {
  const before = new Map<string, number>();
  for (const table of TEARDOWN_ORDER) {
    before.set(table, (await countRows(db, table)).unmarked);
  }

  // Witness tables hold no seeded rows, so their TOTAL must be unchanged. A
  // move here means a cascade reached past the tables this script wrote.
  const witnessBefore = new Map<string, number>();
  for (const table of CASCADE_WITNESS_TABLES) {
    witnessBefore.set(table, await countTotalRows(db, table));
  }
  const profilesBefore = await countTotalRows(db, "profiles");

  const perTable: TeardownReport["perTable"] = [];
  for (const table of TEARDOWN_ORDER) {
    const removed = await deleteSeedRows(db, table);
    const after = (await countRows(db, table)).unmarked;
    const expected = before.get(table) ?? 0;
    if (after !== expected) {
      throw new Error(
        `TEARDOWN ABORTED — collateral damage on ${table}. ` +
          `Rows outside the seed namespace went from ${expected} to ${after}. ` +
          `${removed} seeded rows were removed from this table before the check failed. ` +
          `Investigate before running anything else; later tables were NOT touched.`
      );
    }
    perTable.push({ table, removed, unmarkedBefore: expected, unmarkedAfter: after });
    onProgress(table, removed);
  }

  const authUsersRemoved = await deleteSeedAuthUsers(db);

  // Re-assert AFTER the auth phase. Deleting an auth.users row cascades into
  // public, so the pre-auth per-table check above cannot see that damage — it
  // has already completed by the time the first user is deleted.
  for (const table of TEARDOWN_ORDER) {
    const after = (await countRows(db, table)).unmarked;
    const expected = before.get(table) ?? 0;
    if (after !== expected) {
      throw new Error(
        `TEARDOWN DAMAGE DETECTED AFTER THE AUTH PHASE — ${table} went from ${expected} to ${after} ` +
          "rows outside the seed namespace. Deleting the seeded auth users cascaded into rows this " +
          "script did not create. The seeded rows are already gone; investigate before re-seeding."
      );
    }
  }
  for (const table of CASCADE_WITNESS_TABLES) {
    const after = await countTotalRows(db, table);
    const expected = witnessBefore.get(table) ?? 0;
    if (after !== expected) {
      throw new Error(
        `TEARDOWN DAMAGE DETECTED — ${table} went from ${expected} to ${after} rows. ` +
          "The seed never writes this table, so every row in it belonged to someone else. " +
          "A cascade from a seeded coach/client/auth-user reached it. Investigate immediately."
      );
    }
  }

  // profiles is expected to shrink by EXACTLY the number of auth users removed
  // (handle_new_user writes one row per signup, and the FK cascades). Anything
  // else means the cascade took rows belonging to somebody real.
  const profilesAfter = await countTotalRows(db, "profiles");
  const profilesExpected = profilesBefore - authUsersRemoved;
  if (profilesAfter !== profilesExpected) {
    throw new Error(
      `TEARDOWN DAMAGE DETECTED — profiles went from ${profilesBefore} to ${profilesAfter}, but ` +
        `${authUsersRemoved} seeded auth users were removed, so ${profilesExpected} was expected. ` +
        "The auth cascade reached profiles rows that do not belong to this seed."
    );
  }

  return { perTable, authUsersRemoved, profilesRemoved: profilesBefore - profilesAfter };
}

/**
 * Delete the auth users the seed created, identified by the email domain.
 *
 * Two separate passes, and the separation is the point. `listUsers` pages by
 * OFFSET, so deleting while paging shifts every remaining user left and the
 * next page skips exactly as many users as were just deleted — roughly half the
 * seeded users used to survive a teardown that reported success. Sweep the full
 * list read-only first, then delete from that snapshot.
 *
 * Paging also terminates on an empty page rather than a short one: GoTrue caps
 * `perPage` server-side below whatever is requested, so a short page is the
 * normal case, not the end of the list.
 */
export async function deleteSeedAuthUsers(db: SupabaseClient): Promise<number> {
  const targets: { id: string; email: string }[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; page <= 500; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`teardown listUsers page ${page}: ${error.message}`);
    const users = data?.users ?? [];
    if (users.length === 0) break;
    for (const u of users) {
      if (!isSeedEmail(u.email) || seenIds.has(u.id)) continue;
      seenIds.add(u.id);
      targets.push({ id: u.id, email: u.email ?? "" });
    }
  }

  let removed = 0;
  for (const t of targets) {
    const del = await db.auth.admin.deleteUser(t.id);
    if (del.error) throw new Error(`teardown deleteUser ${t.email}: ${del.error.message}`);
    removed++;
  }
  return removed;
}
