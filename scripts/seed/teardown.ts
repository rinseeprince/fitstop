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
 *
 * The exceptions to "no cascade" are the tables whose seed rows the namespace
 * walk cannot delete: `client_measurements` (migration 158) is append-only for
 * the app role — service_role holds SELECT and INSERT and no DELETE,
 * deliberately — and the goal tables, `client_goals` and
 * `client_goal_deadlines` (migration 193), and the habit tables,
 * `client_habits` with its versions, their weekdays and its one-date edits
 * (migration 203), are written only through their functions, which mint ids
 * outside the seed namespace, and the app role holds SELECT alone on them.
 * Their seed rows leave with their client's row, through the tables' `ON
 * DELETE CASCADE`: they are absent from TEARDOWN_ORDER, and the `clients`
 * delete is what clears them. The habit entries, `client_habit_logs`, carry
 * seed ids and are walked like any other table, before the clients whose
 * habits they point at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteThrowawayLogin, loginsOnDomain } from "../auth-fixtures";
import { SEED_ID_LO, SEED_ID_HI, SEED_EMAIL_DOMAIN } from "./ids";
import { countRows, countTotalRows } from "./db";

/**
 * Exact reverse of the write order in generate.ts. Children before parents at
 * every step, so no row is ever orphaned mid-teardown even if it aborts.
 */
export const TEARDOWN_ORDER: readonly string[] = [
  "check_ins",
  "set_logs",
  "exercise_logs",
  "session_logs",
  "nutrition_logs",
  "wellness_logs",
  "nutrition_plan_daily_targets",
  "nutrition_plans",
  "training_events",
  "training_exercises",
  "training_exercise_groups",
  "training_sessions",
  "training_plans",
  "client_habit_logs",
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
  loginsRemoved: number;
  /** profiles rows that went with the logins. Asserted to equal loginsRemoved. */
  profilesRemoved: number;
};

/**
 * Tables that hold no seeded rows but that a cascade could reach.
 *
 * Deleting a seeded login cascades into `public` (migration 209's keys) — and
 * every seeded coach and client is an FK parent of tables this script never
 * writes (`coach_client_views`, `attention_dismissals`, `client_notes`,
 * `content_assignments`, ...). Those are empty for a seeded principal on a
 * clean run, but a persona login used between seed and teardown populates them,
 * and `content_assignments -> coaches` is ON DELETE NO ACTION, so it would
 * block the coaches delete outright rather than cascade.
 *
 * Guard 4 only ever covered TEARDOWN_ORDER, and only before the login phase.
 * These are checked too, and re-checked after the logins go.
 */
const CASCADE_WITNESS_TABLES: readonly string[] = [
  // NOTE: `profiles` is deliberately NOT here. The path that makes a persona's
  // login writes one profiles row for it (scripts/auth-fixtures.ts), so it IS
  // part of the seed's footprint and is EXPECTED to shrink when those logins
  // go. It gets its own exact-delta assertion below rather than a "must not
  // move" one.
  "coach_client_views",
  "attention_dismissals",
  "client_notes",
  "client_intake",
  "content_assignments",
  "check_in_reminders",
  "nutrition_weekly_summaries",
];

/**
 * Remove every seeded row, asserting no collateral damage.
 *
 * Throws before deleting anything if a table's unmarked count cannot be read,
 * and throws immediately after a table if its unmarked count moved. The
 * seed's logins go too, unless `withLogins` is false: the caller passes false
 * only for a target Better Auth's connection cannot reach, which holds none.
 */
export async function teardown(
  db: SupabaseClient,
  onProgress: (table: string, removed: number) => void,
  withLogins: boolean
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

  const loginsRemoved = withLogins ? await deleteSeedLogins() : 0;

  // Re-assert AFTER the login phase. Deleting a login cascades into public,
  // and so does deleting a parent table later in the walk (a seeded plan takes
  // its targets, a seeded client its rows), so the per-table check above
  // cannot see that damage — it ran before those deletes.
  for (const table of TEARDOWN_ORDER) {
    const after = (await countRows(db, table)).unmarked;
    const expected = before.get(table) ?? 0;
    if (after !== expected) {
      throw new Error(
        `TEARDOWN DAMAGE DETECTED AFTER THE LOGIN PHASE — ${table} went from ${expected} to ${after} ` +
          "rows outside the seed namespace. A cascade from a seeded row deleted after this table's own " +
          "check, or from a seeded login, reached rows with ids outside the namespace: rows the app " +
          "rewrote under a seeded parent, or somebody else's. The seeded rows are already gone; " +
          "investigate before re-seeding."
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
          "A cascade from a seeded coach, client or login reached it. Investigate immediately."
      );
    }
  }

  // profiles is expected to shrink by EXACTLY the number of logins removed
  // (the path that made each login wrote one profile, and it goes with the
  // login). Anything else means the delete took rows belonging to somebody real.
  const profilesAfter = await countTotalRows(db, "profiles");
  const profilesExpected = profilesBefore - loginsRemoved;
  if (profilesAfter !== profilesExpected) {
    throw new Error(
      `TEARDOWN DAMAGE DETECTED — profiles went from ${profilesBefore} to ${profilesAfter}, but ` +
        `${loginsRemoved} seeded logins were removed, so ${profilesExpected} was expected. ` +
        "Deleting the logins reached profiles rows that do not belong to this seed."
    );
  }

  return { perTable, loginsRemoved, profilesRemoved: profilesBefore - profilesAfter };
}

/**
 * Delete the logins the seed made: every login on the seed's own email
 * domain, read in one query and then deleted one by one through
 * scripts/auth-fixtures.ts, each with its profile, sessions and password.
 */
async function deleteSeedLogins(): Promise<number> {
  let removed = 0;
  for (const email of await loginsOnDomain(SEED_EMAIL_DOMAIN)) {
    if (await deleteThrowawayLogin(email)) removed++;
  }
  return removed;
}
