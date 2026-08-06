/**
 * Correctness fixture for the migration-094 RPCs (Session 3.6) and the
 * migration-095 streak RPC + check-in keyset cursor (Session 3.7).
 *
 * Seeds small deterministic fixtures (separate from PERF_CLIENT_ID) and
 * asserts exact outputs the unit tests can no longer cover, because they mock
 * Supabase and therefore never execute the real SQL / PostgREST filter:
 *   - 094 RPCs: identity-union merging, legacy name-fallback, list ordering on
 *     completed_at-tie, PR-date oldest-on-tie, SQL window cap at
 *     p_session_count, COALESCE default guard against LIMIT NULL.
 *   - 095 get_client_streak: gaps-and-islands current/longest, the "run must end
 *     today or yesterday" rule (incl. the isolated-older-log → current 0 edge),
 *     and the empty window.
 *   - check-in keyset: the (created_at, id) `.or()` cursor predicate against real
 *     PostgREST, including a same-created_at tie split across a page boundary.
 *
 * A failure here is a real SQL / PostgREST bug.
 *
 *   npx tsx scripts/perf-correctness.ts
 *
 * Exits non-zero on any mismatch. Idempotent: clean-before-seed.
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { getClientCheckIns } from "@/services/check-in-service";
import { PERF_COACH_ID } from "./perf-fixtures";

// ---------------------------------------------------------------------------
// Fixture identities — hardcoded deterministic UUIDs, "5ca1ec0" prefix so they
// stand out from PERF_* fixtures and any production data.
// ---------------------------------------------------------------------------

const FIXTURE_CLIENT_ID = "5ca1ec0c-0000-4000-8000-000000000001";
const FIXTURE_PLAN_ID = "5ca1ec0c-0000-4000-8000-000000000010";
// Three training_sessions: session_logs has UNIQUE(client, training_session, week_start_date).
// - C+D both fall in week 2026-05-10 → D goes under TS_ALT.
// - F14 (2026-05-03 Sunday) shares a week with SL_B (2026-05-08 Friday) → all F-sessions
//   live under a third training_session TS_F so they don't collide with A-E.
const TS_MAIN = "5ca1ec0c-0000-4000-8000-000000000020";
const TS_ALT = "5ca1ec0c-0000-4000-8000-000000000021";
const TS_F = "5ca1ec0c-0000-4000-8000-000000000022";

// Catalog exercises
const BENCH_ID = "5ca1ec0c-0000-4000-8001-000000000001";
const SQUAT_ID = "5ca1ec0c-0000-4000-8001-000000000002";
const OHP_ID = "5ca1ec0c-0000-4000-8001-000000000003";

// training_exercises (prescription rows). The legacy-name case (Session C)
// uses NULL training_exercise_id on the exercise_log — column is nullable.
const TE_BENCH_DIRECT = "5ca1ec0c-0000-4000-8002-000000000001";
const TE_BENCH_VIA_TE = "5ca1ec0c-0000-4000-8002-000000000002";
const TE_SQUAT = "5ca1ec0c-0000-4000-8002-000000000004";
const TE_OHP = "5ca1ec0c-0000-4000-8002-000000000005";

// Sessions A-E (behavioral) + F1-F14 (window cap)
const SL_A = "5ca1ec0c-0000-4000-8003-00000000000a";
const SL_B = "5ca1ec0c-0000-4000-8003-00000000000b";
const SL_C = "5ca1ec0c-0000-4000-8003-00000000000c";
const SL_D = "5ca1ec0c-0000-4000-8003-00000000000d";
const SL_E = "5ca1ec0c-0000-4000-8003-00000000000e";
function slF(i: number): string {
  // i: 1-14. Use 'f' prefix in the 5th UUID segment so F-sessions don't collide
  // with SL_A..SL_E (which use suffixes 0a..0e in the same segment range).
  return `5ca1ec0c-0000-4000-8003-f${i.toString(16).padStart(11, "0")}`;
}

// Helper: ISO datetime at 09:00 UTC for a given date string
function at9(dateStr: string): string {
  return `${dateStr}T09:00:00+00:00`;
}

// Helper: the Sunday on or before a given YYYY-MM-DD (week_start_date)
function weekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Session 3.7 fixtures — streak RPC (migration 095) + check-in keyset cursor.
// Its own client so cleanup stays scoped; same "5ca1ec0" prefix as above.
// "today" is passed to the RPC explicitly, so the fixture is date-independent.
// ---------------------------------------------------------------------------

const S37_CLIENT_ID = "5ca1ec0c-0000-4000-8000-000000000002";

// Streak: a 5-day run (May 10–14) + a 3-day run ending May 28, gap between.
const STREAK_DATES = [
  "2026-05-10", "2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", // longest run = 5
  "2026-05-26", "2026-05-27", "2026-05-28",                              // recent run = 3
];

// Check-ins: 5 rows; CI_TIE_HI and CI_TIE_LO share created_at 2026-05-06 to
// exercise the (created_at, id) tiebreak. CI_TIE_HI has the larger id, so under
// id DESC it sorts first — the cursor must split the tie across a page boundary.
const CI_1 = "5ca1ec0c-0000-4000-8005-000000000001";      // 2026-05-20
const CI_2 = "5ca1ec0c-0000-4000-8005-000000000002";      // 2026-05-13
const CI_TIE_HI = "5ca1ec0c-0000-4000-8005-0000000000a2"; // 2026-05-06 (sorts first)
const CI_TIE_LO = "5ca1ec0c-0000-4000-8005-0000000000a1"; // 2026-05-06 (sorts second)
const CI_5 = "5ca1ec0c-0000-4000-8005-000000000005";      // 2026-04-29

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("");
  console.log("⚠  perf-correctness fixture against:");
  console.log(`   URL:    ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`   Client: ${FIXTURE_CLIENT_ID}`);
  console.log("");

  await clean();
  await seedCatalog();
  await seedClient();
  await seedPlanAndExercises();
  await seedSessionsAndLogs();
  await seedStreakAndCheckin();

  const failures: string[] = [];

  await assertList(failures);
  await assertPRs(failures);
  await assertProgressionBench(failures);
  await assertProgressionWindowCap(failures);
  await assertProgressionCoalesceDefault(failures);
  await assertProgressionWindowUncapped(failures);
  await assertListWindow(failures);
  await assertLegacyNameFallback(failures);
  await assertStreak(failures);
  await assertCheckinCursor(failures);

  if (failures.length > 0) {
    console.error("");
    console.error(`✗ ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("");
  console.log("✓ all correctness assertions passed");
}

// ---------------------------------------------------------------------------
// Clean — scoped deletes only
// ---------------------------------------------------------------------------

async function clean() {
  console.log("Cleaning prior fixture rows...");

  // session_logs cascades to exercise_logs → set_logs
  await del("session_logs",
    supabaseAdmin.from("session_logs").delete().eq("client_id", FIXTURE_CLIENT_ID));
  // training_plans cascades to training_sessions → training_exercises
  await del("training_plans",
    supabaseAdmin.from("training_plans").delete().eq("client_id", FIXTURE_CLIENT_ID));
  await del("clients",
    supabaseAdmin.from("clients").delete().eq("id", FIXTURE_CLIENT_ID));
  // Catalog exercises: scoped by fixture UUIDs only
  await del("exercises (catalog)",
    supabaseAdmin.from("exercises").delete().in("id", [BENCH_ID, SQUAT_ID, OHP_ID]));

  // Session 3.7 fixture — delete children before the client row.
  await del("daily_logs (3.7)",
    supabaseAdmin.from("daily_logs").delete().eq("client_id", S37_CLIENT_ID));
  await del("check_ins (3.7)",
    supabaseAdmin.from("check_ins").delete().eq("client_id", S37_CLIENT_ID));
  await del("clients (3.7)",
    supabaseAdmin.from("clients").delete().eq("id", S37_CLIENT_ID));
}

async function del(label: string, op: { error: { message: string } | null } | PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await op;
  if (error) throw new Error(`Clean failed for ${label}: ${error.message}`);
  console.log(`  cleared ${label}`);
}

// ---------------------------------------------------------------------------
// Catalog — three global exercises (coach_id NULL)
// ---------------------------------------------------------------------------

async function seedCatalog() {
  console.log("Seeding catalog exercises...");
  const { error } = await supabaseAdmin.from("exercises").insert([
    { id: BENCH_ID, coach_id: null, name: "Fixture Bench Press" },
    { id: SQUAT_ID, coach_id: null, name: "Fixture Squat" },
    { id: OHP_ID, coach_id: null, name: "Fixture Overhead Press" },
  ]);
  if (error) throw new Error(`catalog seed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

async function seedClient() {
  console.log("Seeding fixture client...");
  const { error } = await supabaseAdmin.from("clients").insert({
    id: FIXTURE_CLIENT_ID,
    coach_id: PERF_COACH_ID,
    name: "Perf Correctness Client",
    email: "perf-correctness@fixture.local",
    active: true,
    unit_preference: "imperial",
  });
  if (error) throw new Error(`client seed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Training plan + session + exercises
// ---------------------------------------------------------------------------

async function seedPlanAndExercises() {
  console.log("Seeding training plan / session / exercises...");

  const { error: planErr } = await supabaseAdmin.from("training_plans").insert({
    id: FIXTURE_PLAN_ID,
    client_id: FIXTURE_CLIENT_ID,
    coach_id: PERF_COACH_ID,
    name: "Perf Correctness Plan",
    coach_prompt: "fixture",
    split_type: "full_body",
    frequency_per_week: 1,
  });
  if (planErr) throw new Error(`plan: ${planErr.message}`);

  const { error: sessErr } = await supabaseAdmin.from("training_sessions").insert([
    { id: TS_MAIN, plan_id: FIXTURE_PLAN_ID, name: "Fixture Session Main", order_index: 0 },
    { id: TS_ALT, plan_id: FIXTURE_PLAN_ID, name: "Fixture Session Alt", order_index: 1 },
    { id: TS_F, plan_id: FIXTURE_PLAN_ID, name: "Fixture Session F (OHP)", order_index: 2 },
  ]);
  if (sessErr) throw new Error(`session: ${sessErr.message}`);

  const { error: exErr } = await supabaseAdmin.from("training_exercises").insert([
    // Case A/E: el.exercise_id=BENCH_ID; te.exercise_id also BENCH_ID (canonical)
    { id: TE_BENCH_DIRECT, session_id: TS_MAIN, name: "Bench Press", order_index: 0, sets: 2, exercise_id: BENCH_ID },
    // Case B: el.exercise_id=NULL but te.exercise_id=BENCH_ID — the dual-identity branch
    { id: TE_BENCH_VIA_TE, session_id: TS_MAIN, name: "Bench Press", order_index: 1, sets: 2, exercise_id: BENCH_ID },
    // Case D: el.exercise_id=SQUAT_ID, under TS_ALT to dodge the C/D same-week UNIQUE collision
    { id: TE_SQUAT, session_id: TS_ALT, name: "Squat", order_index: 0, sets: 1, exercise_id: SQUAT_ID },
    // F1-F14: 14 OHP sessions under TS_F
    { id: TE_OHP, session_id: TS_F, name: "Overhead Press", order_index: 0, sets: 1, exercise_id: OHP_ID },
  ]);
  if (exErr) throw new Error(`training_exercises: ${exErr.message}`);
}

// ---------------------------------------------------------------------------
// Session logs, exercise logs, set logs
// ---------------------------------------------------------------------------

type SetSpec = { reps: number; weight: number };
type SessionSpec = {
  id: string;
  trainingSessionId: string;
  completedAt: string;
  exercises: Array<{
    teId: string | null;
    exerciseId: string | null;
    performedName: string;
    sets: SetSpec[];
  }>;
};

async function seedSessionsAndLogs() {
  console.log("Seeding session_logs / exercise_logs / set_logs...");

  // Build F1..F14: weekly OHP sessions from 2026-02-01 to 2026-05-03 (Sundays)
  const fSessions: SessionSpec[] = [];
  for (let i = 1; i <= 14; i++) {
    const date = new Date("2026-02-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + (i - 1) * 7);
    const dateStr = date.toISOString().slice(0, 10);
    fSessions.push({
      id: slF(i),
      trainingSessionId: TS_F,
      completedAt: at9(dateStr),
      exercises: [
        {
          teId: TE_OHP,
          exerciseId: OHP_ID,
          performedName: "Overhead Press",
          sets: [{ reps: 5, weight: 50 + 2.5 * (i - 1) }],
        },
      ],
    });
  }

  const sessions: SessionSpec[] = [
    // A: Bench, direct exercise_id path, 2 sets — also the "5@100" PR baseline for reps=5
    {
      id: SL_A,
      trainingSessionId: TS_MAIN,
      completedAt: at9("2026-05-01"),
      exercises: [{
        teId: TE_BENCH_DIRECT,
        exerciseId: BENCH_ID,
        performedName: "Bench Press",
        sets: [{ reps: 5, weight: 100 }, { reps: 8, weight: 80 }],
      }],
    },
    // B: Bench, dual-identity (el.exercise_id=NULL, te.exercise_id=BENCH_ID) — 5@110 is the PR
    {
      id: SL_B,
      trainingSessionId: TS_MAIN,
      completedAt: at9("2026-05-08"),
      exercises: [{
        teId: TE_BENCH_VIA_TE,
        exerciseId: null,
        performedName: "Bench Press",
        sets: [{ reps: 5, weight: 110 }, { reps: 8, weight: 75 }],
      }],
    },
    // C: legacy Deadlift (both el.exercise_id and te.exercise_id NULL) — name fallback
    {
      id: SL_C,
      trainingSessionId: TS_MAIN,
      completedAt: at9("2026-05-15"),
      exercises: [{
        teId: null,
        exerciseId: null,
        performedName: "Deadlift",
        sets: [{ reps: 3, weight: 200 }],
      }],
    },
    // D: Squat, same completed_at as C — pins list ordering tiebreak (name ASC: Deadlift < Squat).
    // Under TS_ALT so it doesn't violate UNIQUE(client, training_session, week) with C.
    {
      id: SL_D,
      trainingSessionId: TS_ALT,
      completedAt: at9("2026-05-15"),
      exercises: [{
        teId: TE_SQUAT,
        exerciseId: SQUAT_ID,
        performedName: "Squat",
        sets: [{ reps: 5, weight: 140 }],
      }],
    },
    // E: Bench again, 5@110 — tied with B's 5@110, on a later date
    {
      id: SL_E,
      trainingSessionId: TS_MAIN,
      completedAt: at9("2026-05-22"),
      exercises: [{
        teId: TE_BENCH_DIRECT,
        exerciseId: BENCH_ID,
        performedName: "Bench Press",
        sets: [{ reps: 5, weight: 110 }],
      }],
    },
    ...fSessions,
  ];

  // Insert session_logs
  const sessionLogRows = sessions.map((s) => ({
    id: s.id,
    client_id: FIXTURE_CLIENT_ID,
    training_session_id: s.trainingSessionId,
    completed_at: s.completedAt,
    completion_quality: "full",
    week_start_date: weekStart(s.completedAt.slice(0, 10)),
  }));
  const { error: slErr } = await supabaseAdmin.from("session_logs").insert(sessionLogRows);
  if (slErr) throw new Error(`session_logs: ${slErr.message}`);

  // exercise_logs (one per session here; B7's "multiple exercise_logs per session"
  // is exercised by the unit tests, not this harness)
  const exerciseLogRows: Array<Record<string, unknown>> = [];
  const setLogRows: Array<Record<string, unknown>> = [];
  let logCounter = 0;
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const elId = makeUUID("0c00", logCounter++);
      exerciseLogRows.push({
        id: elId,
        session_log_id: s.id,
        training_exercise_id: ex.teId,
        exercise_id: ex.exerciseId,
        performed_name: ex.performedName,
        completed: true,
        prescribed_exercise_snapshot: { name: ex.performedName, sets: ex.sets.length },
      });
      ex.sets.forEach((set, idx) => {
        setLogRows.push({
          exercise_log_id: elId,
          set_number: idx + 1,
          reps: set.reps,
          weight: set.weight,
        });
      });
    }
  }
  // Dynamic-shape rows in a seed script — widen at the insert call, same as
  // scripts/seed-scale-client.ts. Not a production-path type escape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: elErr } = await (supabaseAdmin.from("exercise_logs").insert as any)(exerciseLogRows);
  if (elErr) throw new Error(`exercise_logs: ${elErr.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: setErr } = await (supabaseAdmin.from("set_logs").insert as any)(setLogRows);
  if (setErr) throw new Error(`set_logs: ${setErr.message}`);

  console.log(`  inserted ${sessionLogRows.length} session_logs, ${exerciseLogRows.length} exercise_logs, ${setLogRows.length} set_logs`);
}

function makeUUID(grp: string, idx: number): string {
  const hex = idx.toString(16).padStart(8, "0");
  return `5ca1ec0c-0000-4000-${grp}-0000${hex.slice(0, 4)}${hex.slice(4)}`;
}

// ---------------------------------------------------------------------------
// Session 3.7 seed — its own client with daily_logs (streak) + check_ins (cursor)
// ---------------------------------------------------------------------------

async function seedStreakAndCheckin() {
  console.log("Seeding 3.7 streak daily_logs + keyset check_ins...");

  const { error: cErr } = await supabaseAdmin.from("clients").insert({
    id: S37_CLIENT_ID,
    coach_id: PERF_COACH_ID,
    name: "Perf 3.7 Client",
    email: "perf-3-7@fixture.local",
    active: true,
    unit_preference: "imperial",
  });
  if (cErr) throw new Error(`3.7 client seed: ${cErr.message}`);

  const dlRows = STREAK_DATES.map((date, i) => ({
    id: makeUUID("0d00", i),
    client_id: S37_CLIENT_ID,
    date,
  }));
  const { error: dlErr } = await supabaseAdmin.from("daily_logs").insert(dlRows);
  if (dlErr) throw new Error(`3.7 daily_logs seed: ${dlErr.message}`);

  // created_at set explicitly (overriding DEFAULT now()) to control the ordering
  // and the same-created_at tie. client_id is TEXT on check_ins (migration 023).
  const ciRows = [
    { id: CI_1, client_id: String(S37_CLIENT_ID), status: "reviewed", created_at: at9("2026-05-20") },
    { id: CI_2, client_id: String(S37_CLIENT_ID), status: "reviewed", created_at: at9("2026-05-13") },
    { id: CI_TIE_HI, client_id: String(S37_CLIENT_ID), status: "reviewed", created_at: at9("2026-05-06") },
    { id: CI_TIE_LO, client_id: String(S37_CLIENT_ID), status: "reviewed", created_at: at9("2026-05-06") },
    { id: CI_5, client_id: String(S37_CLIENT_ID), status: "reviewed", created_at: at9("2026-04-29") },
  ];
  // Dynamic-shape rows in a seed script — widen at the insert call, same as
  // the exercise_logs/set_logs inserts above. Not a production-path type escape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: ciErr } = await (supabaseAdmin.from("check_ins").insert as any)(ciRows);
  if (ciErr) throw new Error(`3.7 check_ins seed: ${ciErr.message}`);

  console.log(`  inserted ${dlRows.length} daily_logs + ${ciRows.length} check_ins for the 3.7 client`);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function assertList(failures: string[]) {
  console.log("Asserting get_client_exercise_list...");
  const { data, error } = await supabaseAdmin.rpc("get_client_exercise_list", {
    p_client_id: FIXTURE_CLIENT_ID,
  });
  if (error) {
    failures.push(`list: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];

  // Expected (frequency DESC, then name ASC):
  //   OHP    14 logs, exercise_id=OHP_ID,   last=2026-05-03
  //   Bench  3 logs,  exercise_id=BENCH_ID, last=2026-05-22
  //   Deadlift 1 log, exercise_id=NULL,     name="Deadlift"  (tiebreak on name ASC: D < S)
  //   Squat  1 log,   exercise_id=SQUAT_ID, name="Squat"

  if (rows.length !== 4) {
    failures.push(`list: expected 4 rows, got ${rows.length}`);
    return;
  }
  expect(rows[0], "list[0]", { exercise_id: OHP_ID, log_count: 14 }, failures);
  expect(rows[1], "list[1]", { exercise_id: BENCH_ID, log_count: 3 }, failures);
  expect(rows[2], "list[2]", { exercise_id: null, log_count: 1, name: "Deadlift" }, failures);
  expect(rows[3], "list[3]", { exercise_id: SQUAT_ID, log_count: 1 }, failures);

  if (!rows[1].last_logged_date?.startsWith("2026-05-22")) {
    failures.push(`list[1].last_logged_date: expected 2026-05-22, got ${rows[1].last_logged_date}`);
  }
}

async function assertPRs(failures: string[]) {
  console.log("Asserting get_exercise_prs(BENCH_ID)...");
  const { data, error } = await supabaseAdmin.rpc("get_exercise_prs", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_exercise_id: BENCH_ID,
  });
  if (error) {
    failures.push(`prs: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];

  if (rows.length !== 2) {
    failures.push(`prs: expected 2 rows, got ${rows.length}`);
    return;
  }
  expect(rows[0], "prs[0]", { reps: 5, weight: 110 }, failures);
  expect(rows[1], "prs[1]", { reps: 8, weight: 80 }, failures);

  // The critical one: PR-date tiebreak is completed_at ASC (oldest-on-tie)
  // Session B (2026-05-08) and Session E (2026-05-22) both have 5@110.
  // We expect Session B's date, not E's.
  if (!rows[0].date?.startsWith("2026-05-08")) {
    failures.push(
      `prs[0].date: expected 2026-05-08 (oldest-on-tie); got ${rows[0].date} ` +
      `— probable regression in get_exercise_prs ORDER BY (completed_at DESC instead of ASC).`
    );
  }
  if (!rows[1].date?.startsWith("2026-05-01")) {
    failures.push(`prs[1].date: expected 2026-05-01, got ${rows[1].date}`);
  }
}

async function assertProgressionBench(failures: string[]) {
  console.log("Asserting get_exercise_progression_window(BENCH_ID, sessionCount=12)...");
  const { data, error } = await supabaseAdmin.rpc("get_exercise_progression_window", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_exercise_id: BENCH_ID,
    p_session_count: 12,
  });
  if (error) {
    failures.push(`progression-bench: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];

  // 3 Bench sessions (A, B, E), 5 sets total (A:2, B:2, E:1)
  if (rows.length !== 5) {
    failures.push(`progression-bench: expected 5 flat rows (3 sessions × respective sets), got ${rows.length}`);
  }
  const distinctSessions = new Set(rows.map((r) => r.session_log_id));
  if (distinctSessions.size !== 3) {
    failures.push(`progression-bench: expected 3 distinct session_log_ids, got ${distinctSessions.size}`);
  }
}

async function assertProgressionWindowCap(failures: string[]) {
  console.log("Asserting OHP progression cap at sessionCount=12 (of 14 total)...");
  const { data, error } = await supabaseAdmin.rpc("get_exercise_progression_window", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_exercise_id: OHP_ID,
    p_session_count: 12,
  });
  if (error) {
    failures.push(`progression-ohp-12: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];

  // OHP has 14 weekly sessions, 1 exercise_log + 1 set each. Most-recent 12 should
  // be F3..F14 (i.e. sessions 3 through 14 of the 14 by index). One row per set
  // since each session has exactly one set, so 12 rows total.
  const distinctSessions = new Set(rows.map((r) => r.session_log_id));
  if (distinctSessions.size !== 12) {
    failures.push(
      `progression-ohp-12: expected exactly 12 distinct session_log_ids; got ${distinctSessions.size}. ` +
      `Probable regression: SQL window LIMIT not honoring p_session_count.`
    );
  }
  // The 2 oldest (F1=02-01, F2=02-08) must not appear
  const dates = rows.map((r) => r.completed_at?.slice(0, 10));
  if (dates.includes("2026-02-01")) {
    failures.push("progression-ohp-12: 2026-02-01 (F1) must be excluded — only 12 most-recent should return");
  }
  if (dates.includes("2026-02-08")) {
    failures.push("progression-ohp-12: 2026-02-08 (F2) must be excluded — only 12 most-recent should return");
  }
}

async function assertProgressionCoalesceDefault(failures: string[]) {
  console.log("Asserting OHP progression default applies when p_session_count omitted (LIMIT COALESCE guard)...");
  const { data, error } = await supabaseAdmin.rpc("get_exercise_progression_window", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_exercise_id: OHP_ID,
    // p_session_count intentionally omitted — supabase-js may send null in the body;
    // either way the SQL must default to 12 via COALESCE(p_session_count, 12).
  });
  if (error) {
    failures.push(`progression-ohp-default: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];
  const distinctSessions = new Set(rows.map((r) => r.session_log_id));
  if (distinctSessions.size !== 12) {
    failures.push(
      `progression-ohp-default: expected exactly 12 distinct session_log_ids (COALESCE default), got ${distinctSessions.size}. ` +
      `Probable regression: LIMIT p_session_count without COALESCE → LIMIT NULL → unbounded.`
    );
  }
}

async function assertProgressionWindowUncapped(failures: string[]) {
  console.log("Asserting OHP progression is UNCAPPED within a date window (Session 7.7)...");
  // OHP has 14 weekly sessions (F1=2026-02-01 .. F14=2026-05-03). A window that
  // spans all of them with NO p_session_count must return all 14 (>12): the
  // 12-session floor applies ONLY all-time, never within a window. A regression
  // that re-caps at 12 (SQL CASE wrong, or service sending p_session_count=12)
  // silently truncates every phase/program chart.
  const { data, error } = await supabaseAdmin.rpc("get_exercise_progression_window", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_exercise_id: OHP_ID,
    p_start_date: "2026-01-01",
    p_end_date: "2026-06-01",
    // p_session_count omitted → COALESCE(NULL, CASE …window not null… END) = NULL → unbounded
  });
  if (error) {
    failures.push(`progression-window-uncapped: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];
  const distinctSessions = new Set(rows.map((r) => r.session_log_id));
  if (distinctSessions.size !== 14) {
    failures.push(
      `progression-window-uncapped: expected all 14 in-window sessions (>12), got ${distinctSessions.size}. ` +
      `Probable regression: window-aware LIMIT re-capped at 12, or service sent p_session_count=12.`
    );
  }
  const dates = rows.map((r) => r.completed_at?.slice(0, 10));
  if (!dates.includes("2026-02-01")) {
    failures.push(
      "progression-window-uncapped: F1 (2026-02-01) must appear within the window — the 12-cap that excludes it must NOT apply when bounded."
    );
  }
}

async function assertListWindow(failures: string[]) {
  console.log("Asserting get_client_exercise_list honours a date window (Session 7.7)...");
  // [2026-02-01, 2026-02-20] covers only OHP F1/F2/F3 (02-01, 02-08, 02-15);
  // F4 (02-22) and every May A–E bench/squat log fall outside, so the window
  // returns exactly one exercise (OHP) with log_count 3.
  const { data, error } = await supabaseAdmin.rpc("get_client_exercise_list", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_start_date: "2026-02-01",
    p_end_date: "2026-02-20",
  });
  if (error) {
    failures.push(`list-window: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];
  if (rows.length !== 1) {
    failures.push(`list-window: expected exactly 1 in-window exercise (OHP), got ${rows.length}`);
    return;
  }
  expect(rows[0], "list-window[0]", { exercise_id: OHP_ID, log_count: 3 }, failures);
}

async function assertLegacyNameFallback(failures: string[]) {
  console.log("Asserting get_exercise_prs(exerciseName='Deadlift')...");
  const { data, error } = await supabaseAdmin.rpc("get_exercise_prs", {
    p_client_id: FIXTURE_CLIENT_ID,
    p_exercise_name: "Deadlift",
  });
  if (error) {
    failures.push(`prs-legacy: rpc error ${error.message}`);
    return;
  }
  const rows = data ?? [];
  if (rows.length !== 1) {
    failures.push(`prs-legacy: expected 1 row, got ${rows.length}`);
    return;
  }
  expect(rows[0], "prs-legacy[0]", { reps: 3, weight: 200 }, failures);
}

async function assertStreak(failures: string[]) {
  console.log("Asserting get_client_streak (gaps-and-islands, migration 095)...");

  // "today" is a parameter, so each case fixes it explicitly against the same logs.
  const cases = [
    { today: "2026-05-28", start: "2026-01-01", current: 3, longest: 5, note: "run ends today" },
    { today: "2026-05-29", start: "2026-01-01", current: 3, longest: 5, note: "run ends yesterday (grace)" },
    { today: "2026-05-30", start: "2026-01-01", current: 0, longest: 5, note: "most-recent log 2d ago → current 0 (the edge mocks can't prove)" },
    { today: "2026-06-02", start: "2026-06-01", current: 0, longest: 0, note: "empty window" },
  ];

  for (const c of cases) {
    const { data, error } = await supabaseAdmin.rpc("get_client_streak", {
      p_client_id: S37_CLIENT_ID,
      p_today: c.today,
      p_start_date: c.start,
    });
    if (error) {
      failures.push(`streak[p_today=${c.today}]: rpc error ${error.message}`);
      continue;
    }
    const row = (data ?? [])[0] ?? { current_streak: 0, longest_streak: 0 };
    expect(
      row,
      `streak[p_today=${c.today}] (${c.note})`,
      { current_streak: c.current, longest_streak: c.longest },
      failures
    );
  }
}

async function assertCheckinCursor(failures: string[]) {
  console.log("Asserting check-in keyset cursor (.or (created_at,id) tiebreak, real PostgREST)...");

  // Page 1 (no cursor): newest 3, DESC by (created_at, id). CI_TIE_HI is the
  // last row here, so the tie is poised to split across the page boundary.
  const page1 = await getClientCheckIns(S37_CLIENT_ID, { limit: 3, keyset: true });
  const ids1 = page1.checkIns.map((c) => c.id);
  if (JSON.stringify(ids1) !== JSON.stringify([CI_1, CI_2, CI_TIE_HI])) {
    failures.push(`cursor page1: expected [CI_1, CI_2, CI_TIE_HI], got ${JSON.stringify(ids1)}`);
  }
  if (!page1.nextCursor) {
    failures.push("cursor page1: expected a nextCursor (2 more rows exist), got null");
    return;
  }

  // Page 2 (cursor on CI_TIE_HI): the id-DESC tiebreak must continue with
  // CI_TIE_LO (same created_at, smaller id) — not skip it, not re-emit CI_TIE_HI.
  const page2 = await getClientCheckIns(S37_CLIENT_ID, { limit: 3, cursor: page1.nextCursor });
  const ids2 = page2.checkIns.map((c) => c.id);
  if (JSON.stringify(ids2) !== JSON.stringify([CI_TIE_LO, CI_5])) {
    failures.push(`cursor page2: expected [CI_TIE_LO, CI_5] (tie split by id, none skipped), got ${JSON.stringify(ids2)}`);
  }

  const overlap = ids2.filter((id) => ids1.includes(id));
  if (overlap.length > 0) {
    failures.push(`cursor: page2 overlaps page1 on ${overlap.join(",")} — id tiebreak failed (would duplicate across pages)`);
  }
  const all = new Set([...ids1, ...ids2]);
  if (all.size !== 5) {
    failures.push(`cursor: expected 5 distinct rows across pages (no gap), got ${all.size}`);
  }
  if (page2.nextCursor !== null) {
    failures.push(`cursor page2: expected nextCursor null (last page), got ${JSON.stringify(page2.nextCursor)}`);
  }
}

// ---------------------------------------------------------------------------
// Tiny assertion helper
// ---------------------------------------------------------------------------

function expect(
  actual: Record<string, unknown>,
  label: string,
  expected: Record<string, unknown>,
  failures: string[]
) {
  for (const [k, v] of Object.entries(expected)) {
    const a = actual[k];
    // Coerce numeric strings (NUMERIC types) for comparison
    const av = typeof a === "string" && typeof v === "number" ? Number(a) : a;
    if (av !== v) {
      failures.push(`${label}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(a)}`);
    }
  }
}

main().catch((err) => {
  console.error("perf-correctness fatal:", err);
  process.exit(1);
});
