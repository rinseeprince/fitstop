/**
 * Database plumbing for the scale seed: batched writes, marked/unmarked row
 * accounting, ANALYZE, and the run manifest.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED_ID_LO, SEED_ID_HI } from "./ids";

/** Chunk size for inserts. Below the ~1000-row PostgREST response cap, and small
 *  enough that a jsonb-bearing table doesn't build a multi-MB request body. */
export const DEFAULT_CHUNK = 500;

/** Concurrent in-flight chunk inserts. Kept modest: the bottleneck is WAN RTT,
 *  but too many parallel writers on one table just creates lock contention. */
const CONCURRENCY = 4;

export function makeAdminClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
}

/** Rows written per table this run. Drives the manifest and the ANALYZE list. */
export type WriteLedger = Map<string, number>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Insert rows in chunks with a bounded worker pool and exponential-backoff retry
 * on transient failures. Never inserts row-by-row: at this volume that is the
 * difference between two minutes and two hours.
 *
 * Errors carry the row range so a failure is locatable in a 775k-row load.
 */
export async function insertInBatches(
  db: SupabaseClient,
  table: string,
  rows: readonly Record<string, unknown>[],
  ledger: WriteLedger,
  opts: { chunkSize?: number; mode?: "insert" | "upsert"; onConflict?: string } = {}
): Promise<void> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK;
  if (rows.length === 0) return;

  const chunks: { from: number; to: number }[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push({ from: i, to: Math.min(i + chunkSize, rows.length) });
  }

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = cursor++;
      if (idx >= chunks.length) return;
      const { from, to } = chunks[idx];
      const slice = rows.slice(from, to);

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const { error } =
          opts.mode === "upsert"
            ? await db.from(table).upsert(slice as never, { onConflict: opts.onConflict })
            : await db.from(table).insert(slice as never);
        if (!error) {
          lastError = null;
          break;
        }
        lastError = error;
        // 23505 (unique) / 23503 (fk) / 23514 (check) are our bug, not transient.
        const code = (error as { code?: string }).code ?? "";
        if (code.startsWith("23")) break;
        await sleep(250 * 2 ** attempt);
      }

      if (lastError) {
        const e = lastError as { code?: string; message?: string; details?: string };
        throw new Error(
          `insert into ${table} failed for rows ${from}..${to - 1} of ${rows.length}: ` +
            `${e.code ?? "?"} ${e.message ?? String(lastError)}${e.details ? ` (${e.details})` : ""}`
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  // An upsert pass rewrites rows the ledger already counted (the training_events
  // back-link), so only inserts add to the row tally. The table still needs to
  // appear in the ledger, because ANALYZE keys off it.
  if (opts.mode === "upsert") {
    if (!ledger.has(table)) ledger.set(table, 0);
  } else {
    ledger.set(table, (ledger.get(table) ?? 0) + rows.length);
  }
}

/** Exact row counts, split by whether the row is inside the seed namespace. */
export async function countRows(
  db: SupabaseClient,
  table: string
): Promise<{ total: number; marked: number; unmarked: number }> {
  const totalRes = await db.from(table).select("*", { count: "exact", head: true });
  if (totalRes.error) throw new Error(`count ${table}: ${totalRes.error.message}`);

  const markedRes = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte("id", SEED_ID_LO)
    .lt("id", SEED_ID_HI);
  if (markedRes.error) throw new Error(`count marked ${table}: ${markedRes.error.message}`);

  const total = totalRes.count ?? 0;
  const marked = markedRes.count ?? 0;
  return { total, marked, unmarked: total - marked };
}

/**
 * Total row count only.
 *
 * For witness tables the seed never writes, "marked" is meaningless and some of
 * them (`coach_client_views`) have no `id` column for the range predicate at
 * all. The assertion there is simply that the total did not move.
 */
export async function countTotalRows(db: SupabaseClient, table: string): Promise<number> {
  const res = await db.from(table).select("*", { count: "exact", head: true });
  if (res.error) throw new Error(`count ${table}: ${res.error.message}`);
  return res.count ?? 0;
}

/**
 * `coach_client_views` has a composite PK `(coach_id, client_id)` and no `id`
 * column, so the generic range predicate does not apply. Its leading PK column
 * is a seeded coach uuid, which is still an index range scan.
 */
export async function countRowsByCoachId(
  db: SupabaseClient,
  table: string
): Promise<{ total: number; marked: number; unmarked: number }> {
  const totalRes = await db.from(table).select("*", { count: "exact", head: true });
  if (totalRes.error) throw new Error(`count ${table}: ${totalRes.error.message}`);
  const markedRes = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte("coach_id", SEED_ID_LO)
    .lt("coach_id", SEED_ID_HI);
  if (markedRes.error) throw new Error(`count marked ${table}: ${markedRes.error.message}`);
  const total = totalRes.count ?? 0;
  const marked = markedRes.count ?? 0;
  return { total, marked, unmarked: total - marked };
}

/**
 * Run ANALYZE on every table the run touched.
 *
 * ANALYZE cannot go through PostgREST, and there is no DATABASE_URL in this
 * repo, so this shells out to the Supabase CLI — the same password-free path
 * (`supabase db query`) the benchmark uses for EXPLAIN.
 *
 * This is a hard prerequisite, not a nicety: without fresh planner statistics
 * after a ~1.6M-row load, EXPLAIN reports plans chosen from stale row estimates
 * and the entire benchmark is compromised. So a failure here throws rather than
 * warning — a silently skipped ANALYZE is worse than a failed seed, because the
 * numbers still look plausible.
 */
/** The project ref `--linked` will actually use, or null if it cannot be read. */
function readLinkedRef(): string | null {
  try {
    const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim().toLowerCase();
    return ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

export function analyzeTables(tables: readonly string[], linked: boolean, expectedRef?: string): void {
  if (tables.length === 0) return;

  // The four guards inspect NEXT_PUBLIC_SUPABASE_URL. The CLI does not: it
  // resolves `--linked` from supabase/.temp/project-ref and never reads that
  // env var at all. So without this check the ANALYZE half of the run targets a
  // project nothing has vetted — it can reach production even when
  // resolveTarget correctly refused production, and it can leave the database
  // that was actually seeded with stale statistics while printing success.
  // Two independently-resolved targets that happen to agree today is luck, not
  // a guard, so assert the agreement instead of relying on it.
  if (linked && expectedRef) {
    const actualRef = readLinkedRef();
    if (actualRef === null) {
      throw new Error(
        "ANALYZE TARGET UNKNOWN — supabase/.temp/project-ref is missing or unreadable, so the\n" +
          "  CLI's --linked target cannot be verified against the guarded target. Refusing to run\n" +
          "  ANALYZE: it would execute against an unvetted project. Run `npx supabase link` first."
      );
    }
    if (actualRef !== expectedRef) {
      throw new Error(
        "ANALYZE TARGET MISMATCH — refusing to run.\n" +
          `  guarded target (NEXT_PUBLIC_SUPABASE_URL): ${expectedRef}\n` +
          `  CLI --linked target (supabase/.temp/project-ref): ${actualRef}\n` +
          "  The seed wrote to the first and ANALYZE would have run against the second.\n" +
          "  Re-link with `npx supabase link --project-ref " + expectedRef + "` and re-run with --skip-analyze,\n" +
          "  then ANALYZE manually — the data is already written."
      );
    }
  }

  // ONE statement, not N joined by newlines. `supabase db query` sends its
  // argument as a prepared statement, and Postgres rejects multiple commands in
  // one of those ("cannot insert multiple commands into a prepared statement"),
  // so the newline-joined form failed outright — and because a failed ANALYZE
  // is fatal here, that turned every otherwise-successful seed into a failure
  // AFTER the data was already written. A DO block is a single command and
  // ANALYZE is permitted inside a transaction, so this runs in one round trip.
  //
  // Identifiers are quoted and validated rather than interpolated raw: these
  // names come from the write ledger today, but this is the one place in the
  // script that builds SQL as text.
  for (const t of tables) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(t)) {
      throw new Error(`refusing to ANALYZE an unexpected table identifier: ${JSON.stringify(t)}`);
    }
  }
  const body = tables.map((t) => `ANALYZE public."${t}";`).join(" ");
  const sql = `DO $$ BEGIN ${body} END $$;`;
  const args = ["supabase", "db", "query", sql, linked ? "--linked" : "--local"];
  try {
    execFileSync("npx", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000 });
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    throw new Error(
      "ANALYZE failed — the benchmark would read stale planner statistics, so this is fatal.\n" +
        `  tables: ${tables.join(", ")}\n` +
        `  ${(e.stderr?.toString() || e.stdout?.toString() || e.message || String(err)).trim()}`
    );
  }
}

// ------------------------------------------------------------- manifest

export type Manifest = {
  seed: number;
  anchorDate: string;
  windowDays: number;
  coaches: number;
  clientsPerCoach: number;
  scale: number;
  targetRef: string;
  idRange: { lo: string; hi: string };
  emailDomain: string;
  /** table -> rows written by this run, in write order. */
  written: Record<string, number>;
  /** table -> unmarked rows observed before the run. Teardown asserts these. */
  unmarkedBefore: Record<string, number>;
  startedAt: string;
  finishedAt: string;
};

export function writeManifest(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
