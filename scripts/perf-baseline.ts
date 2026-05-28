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
    "Measured via direct supabaseAdmin queries that match the production read path (check_ins + clients). The function itself uses createPortalClient() (cookie-bound, Next.js-request-only) and can't run from a script — see Followups.",
  ));

  baselines.push(await measure(
    "calculateStreaks",
    "services/daily-logs-service.ts:285",
    `calculateStreaks(PERF_CLIENT_ID)`,
    () => calculateStreaks(PERF_CLIENT_ID),
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
// admin-equivalent of getClientProgressData (matches services/client-portal-progress.ts:51-95)
// ---------------------------------------------------------------------------

async function simulateGetClientProgressDataViaAdmin(clientId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startIso = startDate.toISOString();

  const checkIns = await supabaseAdmin
    .from("check_ins")
    .select(
      "created_at, weight, body_fat_percentage, waist, hips, chest, arms, thighs, mood, energy, sleep, stress"
    )
    .eq("client_id", String(clientId))
    .gte("created_at", startIso)
    .order("created_at", { ascending: true });

  const clientData = await supabaseAdmin
    .from("clients")
    .select(
      "current_streak, check_in_adherence_rate, goal_weight, goal_body_fat_percentage, starting_weight, starting_body_fat_percentage, current_weight, current_body_fat_percentage, weight_unit, unit_preference"
    )
    .eq("id", clientId)
    .single();

  return {
    checkInRows: checkIns.data?.length ?? 0,
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
  body_metrics: number;
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
    body_metrics: 0,
  };
  const c = String(PERF_CLIENT_ID);

  const queries = [
    ["session_logs", supabaseAdmin.from("session_logs").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["exercise_logs", supabaseAdmin.from("exercise_logs").select("id, session_logs!inner(client_id)", { count: "exact", head: true }).eq("session_logs.client_id", c)],
    ["set_logs", supabaseAdmin.from("set_logs").select("id, exercise_logs!inner(session_logs!inner(client_id))", { count: "exact", head: true }).eq("exercise_logs.session_logs.client_id", c)],
    ["daily_logs", supabaseAdmin.from("daily_logs").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["check_ins", supabaseAdmin.from("check_ins").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["daily_habit_logs", supabaseAdmin.from("daily_habit_logs").select("id", { count: "exact", head: true }).eq("client_id", c)],
    ["body_metrics", supabaseAdmin.from("body_metrics").select("id", { count: "exact", head: true }).eq("client_id", c)],
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
  lines.push(`| body_metrics | ${fixtures.body_metrics} |`);
  lines.push("");
  lines.push(`Reproduce: \`npx tsx scripts/seed-scale-client.ts\` then \`npx tsx scripts/perf-baseline.ts\`.`);
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
  lines.push(`- **\`getClientProgressData\` reads legacy denormalized columns on \`clients\` (\`goal_weight\`, \`starting_weight\`, \`current_weight\`) rather than the \`client_goals\` / \`body_metrics\` tables ARCHITECTURE.md describes as the preferred post-migration source.** Consolidation candidate alongside the \`createPortalClient()\` one.`);
  lines.push(`- **\`check_ins.client_id\` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.`);
  lines.push(`- **\`daily_logs_full\` is a view.** \`calculateStreaks\` reads it directly. Captured wall-time includes view overhead; Session 3.7 should consider materialization or denormalization.`);
  lines.push(`- **3.6 resolved:** \`getClientExerciseList\` / \`getExerciseProgressionSeries\` / \`getExercisePRs\` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior \`PostgREST 1000-row cap\` followup is gone with the multi-call fetch pattern.`);
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
