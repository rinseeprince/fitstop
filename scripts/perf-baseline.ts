/**
 * Perf baseline harness for the 6 hot client read paths.
 *
 *   npx tsx scripts/perf-baseline.ts
 *
 * Patches the `supabaseAdmin` singleton with a telemetry-wrapped version,
 * runs each of the 6 service functions with 1 cold + 5 warm invocations,
 * and writes `docs/perf-baseline.md`. Re-run after each scale session to
 * refresh numbers; the file is a moving snapshot, not a frozen baseline.
 *
 * `getClientProgressData` is the one exception: its production implementation
 * uses `createPortalClient()` (cookie-bound, Next.js-request-only), so we
 * instead measure two direct supabaseAdmin queries with the same SQL shape.
 * Footnoted in the markdown; logged as a backlog item.
 */
import "./env-bootstrap";

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  patchSupabaseAdmin,
  withTelemetry,
  type QueryRecord,
} from "./perf-baseline-wrapper";
import { PERF_CLIENT_ID } from "./perf-fixtures";
import { getBlockFacts } from "@/services/client-blocks-facts-service";
import { listNutritionPlanNotesInRange } from "@/services/nutrition-plan-notes-service";
import { getClientJourney } from "@/services/client-journey-service";

import {
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "@/services/exercise-analytics-service";
import { calculateStreaks } from "@/services/daily-logs-service";
import { getHabitLogs } from "@/services/daily-habits-service";

import { getDateDaysAgo, getTodayDateString } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------

const WARMUP_RUNS = 1;
const COLD_RUNS = 1;
const WARM_RUNS = 5;

type RunResult = {
  label: string;
  totalMs: number;
  queries: QueryRecord[];
  payloadBytes: number;
};

type FunctionBaseline = {
  name: string;
  fileLineHint: string;
  fixtureNote?: string;
  callDescription: string;
  cold: RunResult;
  warm: RunResult[];
  asterisk?: string;
};

async function main() {
  console.log("Patching supabaseAdmin with telemetry wrapper...");
  patchSupabaseAdmin(supabaseAdmin);

  console.log("Warmup query (primes Supabase connection pool)...");
  for (let i = 0; i < WARMUP_RUNS; i++) {
    const { error } = await supabaseAdmin.from("clients").select("id").limit(1);
    if (error) throw new Error(`Warmup failed: ${error.message}`);
  }

  console.log("Selecting hot exercise (most-logged for the perf client)...");
  const hotExerciseId = await findHotExercise();
  console.log(`  hot exercise: ${hotExerciseId}`);

  // Each baseline runs cold (first call after warmup) + WARM_RUNS warm calls.
  const baselines: FunctionBaseline[] = [];

  baselines.push(await measure(
    "getClientExerciseList",
    "services/exercise-analytics-service.ts:160",
    `getClientExerciseList(PERF_CLIENT_ID)`,
    () => getClientExerciseList(PERF_CLIENT_ID),
  ));

  baselines.push(await measure(
    "getExerciseProgressionSeries (sessionCount=12)",
    "services/exercise-analytics-service.ts:213",
    `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`,
    () => getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId: hotExerciseId, sessionCount: 12 }),
  ));

  baselines.push(await measure(
    "getExerciseProgressionSeries (sessionCount=500)",
    "services/exercise-analytics-service.ts:213",
    `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`,
    () => getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId: hotExerciseId, sessionCount: 500 }),
  ));

  baselines.push(await measure(
    "getExercisePRs",
    "services/exercise-analytics-service.ts:329",
    `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`,
    () => getExercisePRs(PERF_CLIENT_ID, { exerciseId: hotExerciseId }),
  ));

  baselines.push(await measure(
    "getClientProgressData (admin-equivalent SQL)",
    "services/client-portal-progress.ts:51",
    `getClientProgressData(PERF_CLIENT_ID, 90)`,
    () => simulateGetClientProgressDataViaAdmin(PERF_CLIENT_ID, 90),
    "Measured via direct supabaseAdmin queries that match the production read path (check_ins + the measurement log + clients with its two reading views). The function itself uses createPortalClient() (cookie-bound, Next.js-request-only) and can't run from a script — see Followups.",
  ));

  baselines.push(await measure(
    "calculateStreaks",
    "services/daily-logs-service.ts:285",
    `calculateStreaks(PERF_CLIENT_ID)`,
    () => calculateStreaks(PERF_CLIENT_ID),
  ));

  // Session 6: the block-facts fan-out and the paged plan-notes read. Both are
  // whole-span reads whose cost must be bounded by the RESULT, not by how long
  // the client has been coached.
  baselines.push(await measure(
    "getBlockFacts (4-way fan-out)",
    "services/client-blocks-facts-service.ts",
    `getBlockFacts(PERF_CLIENT_ID, today)`,
    () => getBlockFacts(PERF_CLIENT_ID, getTodayDateString()),
    "Four parallel reads over the whole journey span, partitioned per block in memory — round trips are constant in the number of blocks, never per-block.",
  ));

  baselines.push(await measure(
    "listNutritionPlanNotesInRange (365d)",
    "services/nutrition-plan-notes-service.ts",
    `listNutritionPlanNotesInRange(PERF_CLIENT_ID, today-365, today)`,
    () => listNutritionPlanNotesInRange(PERF_CLIENT_ID, getDateDaysAgo(365), getTodayDateString()),
    "Paged (fetchAllPages). One page per 1000 rows; the query count below IS the page count.",
  ));

  baselines.push(await measure(
    "getClientJourney",
    "services/client-journey-service.ts",
    `getClientJourney(PERF_CLIENT_ID, today)`,
    () => getClientJourney(PERF_CLIENT_ID, getTodayDateString()),
    "Client Program tab. Reads only the CURRENT block's note window — elapsed blocks' notes never leave the DB.",
  ));

  baselines.push(await measure(
    "getHabitLogs",
    "services/daily-habits-service.ts:273",
    `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`,
    () => getHabitLogs(PERF_CLIENT_ID, getDateDaysAgo(90), getTodayDateString()),
  ));

  const fixtureCounts = await fetchFixtureCounts();

  const md = buildMarkdown(baselines, fixtureCounts);
  writeFileSync("docs/perf-baseline.md", md);
  console.log("");
  console.log("Wrote docs/perf-baseline.md");
  printSummary(baselines);
}

// ---------------------------------------------------------------------------

async function measure(
  name: string,
  fileLineHint: string,
  callDescription: string,
  invoke: () => Promise<unknown>,
  asterisk?: string
): Promise<FunctionBaseline> {
  console.log(`Measuring ${name}...`);

  const coldRuns: RunResult[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    coldRuns.push(await runOnce("cold", invoke));
  }
  const warm: RunResult[] = [];
  for (let i = 0; i < WARM_RUNS; i++) {
    warm.push(await runOnce(`warm-${i + 1}`, invoke));
  }
  return {
    name,
    fileLineHint,
    callDescription,
    cold: coldRuns[0],
    warm,
    asterisk,
  };
}

async function runOnce(label: string, invoke: () => Promise<unknown>): Promise<RunResult> {
  const { queries, totalMs, payloadBytes } = await withTelemetry(invoke);
  return { label, totalMs, queries, payloadBytes };
}

// ---------------------------------------------------------------------------
// admin-equivalent of getClientProgressData (mirrors the three reads in
// services/client-portal-progress.ts: the check-ins' wellness columns, the
// measurement log's live rows, and the client row with its two reading views)
// ---------------------------------------------------------------------------

async function simulateGetClientProgressDataViaAdmin(clientId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startIso = startDate.toISOString();
  const fromDay = startIso.slice(0, 10);

  const [checkIns, readings, clientData] = await Promise.all([
    supabaseAdmin
      .from("check_ins")
      .select("created_at, mood, energy, sleep, stress, soreness")
      .eq("client_id", String(clientId))
      .gte("created_at", startIso)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("client_measurements_live")
      .select("id, metric_key, value, recorded_on, recorded_at, updated_at, measured_at, source, source_id, note")
      .eq("client_id", clientId)
      .gte("recorded_on", fromDay)
      .order("recorded_on", { ascending: true })
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true }),
    supabaseAdmin
      .from("clients")
      .select(
        "current_streak, check_in_adherence_rate, goal_weight, goal_body_fat_percentage, " +
          "client_current_measurements(metric_key, value, recorded_on, source, measurement_id), " +
          "client_baseline_measurements(metric_key, value, recorded_on, source, measurement_id)"
      )
      .eq("id", clientId)
      .single(),
  ]);

  return {
    checkInRows: checkIns.data?.length ?? 0,
    readingRows: readings.data?.length ?? 0,
    clientLoaded: !!clientData.data,
  };
}

// ---------------------------------------------------------------------------
// hot-exercise selection
// ---------------------------------------------------------------------------

async function findHotExercise(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("exercises")
    .select("id, name")
    .is("coach_id", null)
    .order("name", { ascending: true })
    .limit(1);
  if (error) throw new Error(`hot exercise pick: ${error.message}`);
  if (!data || data.length === 0) throw new Error("no global exercises seeded");
  return data[0].id;
}

// ---------------------------------------------------------------------------
// fixture-count summary (one COUNT(*) per relevant table, for the markdown header)
// ---------------------------------------------------------------------------

type FixtureCounts = {
  session_logs: number;
  exercise_logs: number;
  set_logs: number;
  daily_logs: number;
  check_ins: number;
  daily_habit_logs: number;
  client_measurements: number;
  client_phases: number;
  nutrition_plan_notes: number;
};

async function fetchFixtureCounts(): Promise<FixtureCounts> {
  console.log("Counting fixture rows...");
  const out: FixtureCounts = {
    session_logs: 0,
    exercise_logs: 0,
    set_logs: 0,
    daily_logs: 0,
    check_ins: 0,
    daily_habit_logs: 0,
    client_measurements: 0,
    client_phases: 0,
    nutrition_plan_notes: 0,
  };
  const c = String(PERF_CLIENT_ID);

  const queries = [
    ["session_logs", supabaseAdmin.from("session_logs").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["exercise_logs", supabaseAdmin.from("exercise_logs").select("id, session_logs!inner(client_id)", { count: "exact", head: true }).eq("session_logs.client_id", c)],
    ["set_logs", supabaseAdmin.from("set_logs").select("id, exercise_logs!inner(session_logs!inner(client_id))", { count: "exact", head: true }).eq("exercise_logs.session_logs.client_id", c)],
    ["daily_logs", supabaseAdmin.from("daily_logs").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["check_ins", supabaseAdmin.from("check_ins").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["daily_habit_logs", supabaseAdmin.from("daily_habit_logs").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["client_measurements", supabaseAdmin.from("client_measurements_live").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["client_phases", supabaseAdmin.from("client_phases").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["nutrition_plan_notes", supabaseAdmin.from("nutrition_plan_notes").select("id", { count: "exact", head: true }).eq("client_id", c)],
  ] as const;

  for (const [name, q] of queries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (q as any);
    if (error) {
      console.log(`  ${name} count failed (${error.message}); leaving 0`);
      continue;
    }
    (out as Record<string, number>)[name] = count ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function buildMarkdown(baselines: FunctionBaseline[], fixtures: FixtureCounts): string {
  const captured = new Date().toISOString().slice(0, 10);
  let sha = "unknown";
  try {
    sha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    /* git not available */
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "<unset>";
  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const lines: string[] = [];
  lines.push(`# Client portal — perf baseline`);
  lines.push("");
  lines.push(`**Captured:** ${captured} · **Git SHA:** ${sha} · **Target:** ${host}`);
  lines.push(`**Node:** ${process.version} · Moving snapshot — re-run after each scale session (3.6+) to refresh.`);
  lines.push("");
  lines.push(`## Fixture`);
  lines.push("");
  lines.push(`Client: \`${PERF_CLIENT_ID}\``);
  lines.push("");
  lines.push(`| Table | Rows |`);
  lines.push(`|---|---|`);
  lines.push(`| session_logs | ${fixtures.session_logs} |`);
  lines.push(`| exercise_logs | ${fixtures.exercise_logs} |`);
  lines.push(`| set_logs | ${fixtures.set_logs} |`);
  lines.push(`| daily_logs | ${fixtures.daily_logs} |`);
  lines.push(`| check_ins | ${fixtures.check_ins} |`);
  lines.push(`| daily_habit_logs | ${fixtures.daily_habit_logs} |`);
  lines.push(`| client_measurements | ${fixtures.client_measurements} |`);
  lines.push(`| client_phases (journey blocks) | ${fixtures.client_phases} |`);
  lines.push(`| nutrition_plan_notes | ${fixtures.nutrition_plan_notes} |`);
  lines.push("");
  lines.push(`Reproduce: \`npx tsx scripts/seed-scale-client.ts\` then \`npx tsx scripts/perf-baseline.ts\`. Note volume is \`--notes <n>\` (default 52 = roughly weekly saves over the year of tenure); raise it past 1000 to exercise the paged read's second page.`);
  lines.push("");
  lines.push(`Cold = first call after a Supabase connection-warmup query (so cold reflects query/page-cache cold, not TCP/TLS handshake). p50 / p95 use the 5 warm runs only (p95 = max-of-5).`);
  lines.push("");

  for (const b of baselines) {
    renderBaseline(b, lines);
  }

  lines.push("");
  lines.push(`## Followups (out of 3.5 scope)`);
  lines.push("");
  lines.push(`- **\`createPortalClient()\` consolidation candidate (CONVENTIONS §8).** \`services/client-portal-progress.ts\` uses a session-scoped Supabase client when most service functions default to \`supabaseAdmin\` with explicit scoping. Phase 9 tech-debt sweep should reconcile — services should default to \`supabaseAdmin\`; session-scoped is the rare case.`);
  lines.push(`- **\`getClientProgressData\` reads the measurement log** — its live rows and the two reading views (\`client_current_measurements\`, \`client_baseline_measurements\`) under the client's own JWT through the D6 policy. Only the \`createPortalClient()\` consolidation above remains open.`);
  lines.push(`- **\`check_ins.client_id\` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.`);
  lines.push(`- **3.6 resolved:** \`getClientExerciseList\` / \`getExerciseProgressionSeries\` / \`getExercisePRs\` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior \`PostgREST 1000-row cap\` followup is gone with the multi-call fetch pattern.`);
  lines.push(`- **3.7 resolved:** \`calculateStreaks\` no longer reads the \`daily_logs_full\` view + runs an O(D²) Node loop; it now calls the \`get_client_streak\` gaps-and-islands RPC (migration 095) over the \`daily_logs\` spine via the \`(client_id, date DESC)\` index, returning two integers (result-bounded, not history-bounded).`);
  lines.push("");

  return lines.join("\n");
}

function renderBaseline(b: FunctionBaseline, out: string[]) {
  out.push(`## ${b.name}`);
  out.push("");
  out.push(`**File:** \`${b.fileLineHint}\` · **Call:** \`${b.callDescription}\``);
  if (b.asterisk) {
    out.push("");
    out.push(`*${b.asterisk}*`);
  }
  out.push("");
  out.push(`| run | wall ms | total rows fetched | payload bytes |`);
  out.push(`|-----|--------:|-------------------:|--------------:|`);
  const runs = [b.cold, ...b.warm];
  for (const r of runs) {
    const totalRows = r.queries.reduce((sum, q) => sum + q.rowCount, 0);
    out.push(`| ${r.label} | ${r.totalMs.toFixed(1)} | ${totalRows} | ${r.payloadBytes} |`);
  }
  out.push("");
  const warmMs = b.warm.map((r) => r.totalMs).sort((a, b) => a - b);
  const p50 = warmMs[Math.floor(warmMs.length / 2)] ?? 0;
  const p95 = warmMs[warmMs.length - 1] ?? 0;
  out.push(`**Warm p50:** ${p50.toFixed(1)} ms · **Warm p95 (max of ${b.warm.length}):** ${p95.toFixed(1)} ms`);

  // Per-query breakdown from a single warm run (the last one — same shape each run)
  const lastWarm = b.warm[b.warm.length - 1];
  if (lastWarm && lastWarm.queries.length > 0) {
    out.push("");
    out.push(`**Query breakdown** (warm run ${b.warm.length}):`);
    out.push("");
    out.push(`| query | table | rows | bytes | ms |`);
    out.push(`|------:|-------|-----:|------:|---:|`);
    lastWarm.queries.forEach((q, i) => {
      out.push(`| ${i + 1} | ${q.table} | ${q.rowCount} | ${q.bytes} | ${q.durationMs.toFixed(1)} |`);
    });
  } else if (b.asterisk) {
    out.push("");
    out.push(`*(See footnote — no per-query telemetry captured for this path.)*`);
  }
  out.push("");
}

// ---------------------------------------------------------------------------

function printSummary(baselines: FunctionBaseline[]) {
  console.log("");
  console.log("Summary (warm p50):");
  for (const b of baselines) {
    const warmMs = b.warm.map((r) => r.totalMs).sort((a, b) => a - b);
    const p50 = warmMs[Math.floor(warmMs.length / 2)] ?? 0;
    const lastQueries = (b.warm[b.warm.length - 1]?.queries ?? []).length;
    console.log(`  ${b.name.padEnd(48)} ${p50.toFixed(1).padStart(7)} ms (${lastQueries} queries)`);
  }
}

main().catch((err) => {
  console.error("Baseline harness failed:", err);
  process.exit(1);
});
