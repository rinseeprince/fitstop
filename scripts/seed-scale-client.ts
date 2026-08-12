/**
 * Year-scale fixture seed for the client portal perf baseline + Sessions 3.6+.
 *
 * Idempotent: delete-then-insert, scoped to the fixed fixture UUIDs in
 * scripts/perf-fixtures.ts. No DELETE statement exists in this file that is
 * not bound to those UUIDs.
 *
 *   npx tsx scripts/seed-scale-client.ts                # standard re-seed
 *   npx tsx scripts/seed-scale-client.ts --full-reset   # also recreate coach/client
 *
 * Flags:
 *   --months <n>            (default 12)
 *   --sessions-per-week <n> (default 4)
 *   --seed <n>              (default 42; xorshift32 PRNG seed)
 *   --full-reset            also delete the seeded coach + client rows
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { computeEnergyPair } from "@/services/client-energy-calc";
import { generateTrainingEvents } from "@/services/training-event-service";
import { generateNutritionEvents } from "@/services/nutrition-event-service";
import {
  getTodayDateString,
  getDateString,
  getDateDaysAgo,
  getDateDaysFrom,
  expandDateRange,
} from "@/lib/date-helpers";
import {
  PERF_COACH_ID,
  PERF_CLIENT_ID,
  PERF_PLAN_ID,
  PERF_NUTRITION_PLAN_ID,
  PERF_NUTRITION_PLAN_V1_ID,
  PERF_CLIENT_GOAL_ID,
  PERF_HABIT_IDS,
  PERF_COACH_EMAIL,
  PERF_COACH_NAME,
  PERF_CLIENT_EMAIL,
  PERF_CLIENT_NAME,
  PERF_CLIENT_PASSWORD,
} from "./perf-fixtures";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

type Args = {
  months: number;
  sessionsPerWeek: number;
  seed: number;
  fullReset: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    months: 12,
    sessionsPerWeek: 4,
    seed: 42,
    fullReset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full-reset") out.fullReset = true;
    else if (a === "--months") out.months = Number(argv[++i]);
    else if (a === "--sessions-per-week") out.sessionsPerWeek = Number(argv[++i]);
    else if (a === "--seed") out.seed = Number(argv[++i]);
  }
  if (!Number.isFinite(out.months) || out.months < 1 || out.months > 24) {
    throw new Error(`--months must be 1-24, got ${out.months}`);
  }
  if (!Number.isFinite(out.sessionsPerWeek) || out.sessionsPerWeek < 1 || out.sessionsPerWeek > 7) {
    throw new Error(`--sessions-per-week must be 1-7, got ${out.sessionsPerWeek}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// xorshift32 PRNG — every randomized value in this file flows through this
// so re-runs are byte-identical given the same --seed.
// ---------------------------------------------------------------------------

function makeRng(seed: number) {
  let state = (seed | 0) || 1;
  return {
    next(): number {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) % 1_000_000) / 1_000_000;
    },
    int(minInclusive: number, maxInclusive: number): number {
      const span = maxInclusive - minInclusive + 1;
      return minInclusive + Math.floor(this.next() * span);
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
  };
}

type Rng = ReturnType<typeof makeRng>;

// ---------------------------------------------------------------------------
// The fixture's metabolism, through the app's own calculator rather than a
// literal — so a reseeded fixture can never contradict what
// recalculateClientEnergy would compute for the same row, which is the exact
// incoherence Session 4B removed from the app. The nutrition plan below
// snapshots the same pair, because a plan snapshots the profile.
// ---------------------------------------------------------------------------

const FIXTURE_ENERGY = (() => {
  const energy = computeEnergyPair({
    weightKg: 83.9,
    heightCm: 178,
    gender: "male",
    bodyFatPercentage: 22,
    activityLevel: "moderately_active",
  });
  if (energy.status !== "ready") {
    throw new Error(`Fixture client is not computable: missing ${energy.missing.join(", ")}`);
  }
  return { bmr: energy.bmr, tdee: energy.tdee };
})();

// ---------------------------------------------------------------------------
// Plan: 4 sessions per week with focuses Push/Pull/Legs/Full
// ---------------------------------------------------------------------------

const SESSION_TEMPLATES = [
  { name: "Push Day", focus: "Chest, shoulders, triceps", dayOfWeek: "monday", orderIndex: 0 },
  { name: "Pull Day", focus: "Back, biceps", dayOfWeek: "tuesday", orderIndex: 1 },
  { name: "Leg Day", focus: "Quads, hamstrings, glutes", dayOfWeek: "thursday", orderIndex: 2 },
  { name: "Full Body", focus: "Compound + accessories", dayOfWeek: "saturday", orderIndex: 3 },
] as const;

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

// 5 habits: 3 boolean, 2 quantitative
const HABIT_TEMPLATES = [
  { name: "Hit step goal", isBoolean: true, target: null as number | null, unit: null as string | null },
  { name: "Drink 3L water", isBoolean: true, target: null, unit: null },
  { name: "10-min mobility", isBoolean: true, target: null, unit: null },
  { name: "Water intake", isBoolean: false, target: 3, unit: "L" },
  { name: "Sleep hours", isBoolean: false, target: 8, unit: "h" },
] as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  console.log("");
  console.log("⚠  Seeding scale fixtures into:");
  console.log(`   URL:    ${url}`);
  console.log(`   Coach:  ${PERF_COACH_ID}`);
  console.log(`   Client: ${PERF_CLIENT_ID}`);
  console.log(`   Flags:  --months=${args.months} --sessions-per-week=${args.sessionsPerWeek} --seed=${args.seed}${args.fullReset ? " --full-reset" : ""}`);
  console.log("   All DELETEs scoped to these UUIDs only.");
  console.log("");

  const t0 = Date.now();
  const rng = makeRng(args.seed);

  await cleanExistingFixtures(args.fullReset);
  await insertCoachAndClient();
  await ensureClientAuthUser();
  const exerciseIds = await pickGlobalExercises();
  await insertClientGoal();
  const nutritionDailyTargets = await insertNutritionPlan();
  const { sessionIds, exerciseRowsBySession, hotExerciseId } = await insertTrainingPlan(exerciseIds, rng);
  await insertHabits();
  const dailyLogIdsByDate = await insertDailyLogsSpine(args.months);
  await insertDailyChildren(dailyLogIdsByDate, rng);
  await insertSessionLogsAndCompletions(sessionIds, exerciseRowsBySession, args, rng);
  await insertHabitLogs(args.months, rng);
  const checkInRows = await insertCheckIns(args.months, rng);
  await insertBodyMetrics(checkInRows, rng);
  await insertTrainingEvents(sessionIds, args.months);
  // After training events (the surplus source) so generated nutrition events
  // pick up the training-day surplus.
  await insertNutritionEvents(args.months, nutritionDailyTargets);

  const elapsedMs = Date.now() - t0;
  console.log("");
  console.log(`Seed complete in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Hot exercise for harness: ${hotExerciseId}`);
}

// ---------------------------------------------------------------------------
// Clean phase — scoped DELETEs only
// ---------------------------------------------------------------------------

async function cleanExistingFixtures(fullReset: boolean) {
  console.log("Cleaning existing fixtures...");

  const c = PERF_CLIENT_ID;
  await del("training_events", supabaseAdmin.from("training_events").delete().eq("client_id", c));
  await del("body_metrics", supabaseAdmin.from("body_metrics").delete().eq("client_id", c));
  await del("check_ins", supabaseAdmin.from("check_ins").delete().eq("client_id", String(c)));
  await del("daily_habit_logs", supabaseAdmin.from("daily_habit_logs").delete().eq("client_id", c));
  await del("daily_habits", supabaseAdmin.from("daily_habits").delete().eq("client_id", c));
  await del("session_logs (→ exercise_logs → set_logs)", supabaseAdmin.from("session_logs").delete().eq("client_id", c));
  await del("training_plans (→ sessions, exercises)", supabaseAdmin.from("training_plans").delete().eq("client_id", c));
  await del("daily_logs (→ wellness/nutrition/training children)", supabaseAdmin.from("daily_logs").delete().eq("client_id", c));
  // nutrition_events FK is ON DELETE SET NULL, so the plan delete below won't
  // cascade them — clear them explicitly or they orphan + survive a reseed.
  await del("nutrition_events", supabaseAdmin.from("nutrition_events").delete().eq("client_id", c));
  await del("nutrition_plans (→ daily_targets)", supabaseAdmin.from("nutrition_plans").delete().eq("client_id", c));
  await del("client_goals", supabaseAdmin.from("client_goals").delete().eq("client_id", c));

  if (fullReset) {
    await del("clients", supabaseAdmin.from("clients").delete().eq("id", c));
    await del("coaches", supabaseAdmin.from("coaches").delete().eq("id", PERF_COACH_ID));
  }
}

async function del(
  label: string,
  // PostgrestFilterBuilder is thenable but TS doesn't see it as Promise<T>;
  // accept anything awaitable that yields { error }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  op: any
): Promise<void> {
  const { error } = await op;
  if (error) throw new Error(`Clean failed for ${label}: ${error.message}`);
  console.log(`  cleared ${label}`);
}

// ---------------------------------------------------------------------------
// Coach + client
// ---------------------------------------------------------------------------

async function insertCoachAndClient() {
  console.log("Inserting coach + client...");

  const { error: coachErr } = await supabaseAdmin
    .from("coaches")
    .upsert(
      { id: PERF_COACH_ID, name: PERF_COACH_NAME, email: PERF_COACH_EMAIL },
      { onConflict: "id", ignoreDuplicates: true }
    );
  if (coachErr) throw new Error(`Coach upsert: ${coachErr.message}`);

  const { error: clientErr } = await supabaseAdmin
    .from("clients")
    .upsert(
      {
        id: PERF_CLIENT_ID,
        coach_id: PERF_COACH_ID,
        name: PERF_CLIENT_NAME,
        email: PERF_CLIENT_EMAIL,
        active: true,
        // unit_preference is the VIEWER's choice and stays imperial — this
        // fixture deliberately exercises an imperial viewer. The VALUES below
        // are canonical kg/cm regardless (migration 141); they used to be the
        // same person in lbs/in (185 lb = 83.9 kg, matching base_weight_kg: 84).
        unit_preference: "imperial",
        current_weight: 83.9,
        goal_weight: 77.1,
        starting_weight: 88.5,
        current_body_fat_percentage: 22,
        goal_body_fat_percentage: 15,
        starting_body_fat_percentage: 26,
        // The fixture carried no height, gender or activity level, so nothing
        // could compute its metabolism and bmr/tdee were literals (1850/2700)
        // that matched no formula. That 1850 is what the Session 4B
        // investigation traced the impossible BMR 3712 / TDEE 3515 pair back
        // to. These three make the row computable; the pair below is derived.
        height: 178,
        gender: "male",
        work_activity_level: "moderately_active",
        ...FIXTURE_ENERGY,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
  if (clientErr) throw new Error(`Client upsert: ${clientErr.message}`);
}

// ---------------------------------------------------------------------------
// Auth user for the perf client (so you can actually log in as them)
//
// Migration 025's on_auth_user_created trigger reads
// raw_user_meta_data->>'role' (defaults to 'trainer') and creates BOTH a
// profiles row AND — for trainers — a coaches row. We pass role='client'
// on creation, then force-correct the profile and remove the spurious
// coaches row in case a previous run (or the trigger default) misclassified.
// Idempotent: looks up by email; safe to re-run.
// ---------------------------------------------------------------------------

async function ensureClientAuthUser() {
  console.log("Ensuring auth user for perf client...");

  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listErr) throw new Error(`auth listUsers: ${listErr.message}`);

  const existing = list.users.find((u) => u.email === PERF_CLIENT_EMAIL);
  let userId: string;

  if (existing) {
    userId = existing.id;
    console.log(`  found existing auth user (id=${userId})`);
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: PERF_CLIENT_EMAIL,
      password: PERF_CLIENT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "client", name: PERF_CLIENT_NAME },
    });
    if (error) throw new Error(`auth createUser: ${error.message}`);
    if (!data.user) throw new Error("auth createUser returned no user");
    userId = data.user.id;
    console.log(`  created auth user (id=${userId})`);
  }

  // Force profile.role = 'client'. The trigger may have defaulted to 'trainer'
  // for users created before this seed passed role metadata.
  const { error: profileErr } = await supabaseAdmin
    .from("profiles")
    .upsert({ user_id: userId, role: "client" }, { onConflict: "user_id" });
  if (profileErr) throw new Error(`profiles upsert: ${profileErr.message}`);
  console.log(`  set profiles.role = client`);

  // Drop any spurious coaches row the default-trainer trigger created for
  // this auth user. The real perf-fixture coach uses PERF_COACH_ID and is
  // unaffected (it has no user_id link).
  const { error: spuriousErr } = await supabaseAdmin
    .from("coaches")
    .delete()
    .eq("user_id", userId);
  if (spuriousErr) throw new Error(`spurious coach cleanup: ${spuriousErr.message}`);
  console.log(`  cleaned any spurious coaches row for this user_id`);

  const { error: linkErr } = await supabaseAdmin
    .from("clients")
    .update({ user_id: userId })
    .eq("id", PERF_CLIENT_ID);
  if (linkErr) throw new Error(`clients.user_id link: ${linkErr.message}`);
  console.log(`  linked clients.user_id → ${PERF_CLIENT_EMAIL}`);
}

// ---------------------------------------------------------------------------
// Global exercise picks
// ---------------------------------------------------------------------------

async function pickGlobalExercises(): Promise<Array<{ id: string; name: string }>> {
  console.log("Picking 20 global exercises...");
  const { data, error } = await supabaseAdmin
    .from("exercises")
    .select("id, name")
    .is("coach_id", null)
    .order("name", { ascending: true })
    .limit(20);
  if (error) throw new Error(`exercises pick: ${error.message}`);
  if (!data || data.length < 6) {
    throw new Error(
      `Need at least 6 global exercises (coach_id IS NULL); found ${data?.length ?? 0}. ` +
        `Run scripts/seed-exercise-catalog.ts first.`
    );
  }
  console.log(`  picked ${data.length} exercises`);
  return data;
}

// ---------------------------------------------------------------------------
// Client goal placeholder
// ---------------------------------------------------------------------------

async function insertClientGoal() {
  console.log("Inserting client_goals placeholder...");
  const { error } = await supabaseAdmin.from("client_goals").insert({
    id: PERF_CLIENT_GOAL_ID,
    client_id: PERF_CLIENT_ID,
    goal_weight: 77.1, // kg (was 170 lb)
    goal_body_fat_percentage: 15,
    primary_goal: "fat_loss",
    set_by: "coach",
    notes: "Perf seed placeholder",
  });
  if (error) throw new Error(`client_goals insert: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Nutrition plan placeholder + 7 daily targets
// ---------------------------------------------------------------------------

async function insertNutritionPlan() {
  console.log("Inserting nutrition_plans version pair (closed + open) + daily targets...");

  // Versioned model (migration 144): a closed predecessor + the open current
  // version, tiling the client's tenure, so date-resolved lookups
  // (coversDate, per-era history attribution) are exercised by the fixture
  // instead of degenerating to a single covering row.
  const v1From = getDateDaysAgo(365);
  const v1Until = getDateDaysAgo(91);
  const v2From = getDateDaysAgo(90);

  const shared = {
    client_id: PERF_CLIENT_ID,
    coach_id: PERF_COACH_ID,
    name: "Perf seed plan",
    status: "active",
    work_activity_level: "moderately_active",
    training_volume_hours: "3-5",
    protein_target_g_per_kg: 2.0,
    diet_type: "balanced",
    protein_target_g: 170,
    carb_target_g: 280,
    fat_target_g: 70,
    base_weight_kg: 84,
    // Snapshotted from the profile, like every real plan save.
    ...FIXTURE_ENERGY,
  };
  const { error: planErr } = await supabaseAdmin.from("nutrition_plans").insert([
    {
      ...shared,
      id: PERF_NUTRITION_PLAN_V1_ID,
      effective_from: v1From,
      effective_until: v1Until,
      baseline_calories: 2300,
    },
    {
      ...shared,
      id: PERF_NUTRITION_PLAN_ID,
      effective_from: v2From,
      effective_until: null,
      baseline_calories: 2400,
    },
  ]);
  if (planErr) throw new Error(`nutrition_plans insert: ${planErr.message}`);

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const gridFor = (planId: string, baseline: number) =>
    days.map((dow) => ({
      nutrition_plan_id: planId,
      day_of_week: dow,
      calories: dow === "sunday" ? baseline - 200 : baseline,
      protein_g: 170,
      carb_g: 280,
      fat_g: 70,
      is_training_day: ["monday", "tuesday", "thursday", "saturday"].includes(dow),
    }));
  const dailyTargets = gridFor(PERF_NUTRITION_PLAN_ID, 2400);
  const { error: tgtErr } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .insert([...gridFor(PERF_NUTRITION_PLAN_V1_ID, 2300), ...dailyTargets]);
  if (tgtErr) throw new Error(`nutrition_plan_daily_targets insert: ${tgtErr.message}`);

  // The OPEN version's grid — event generation fills the forward window from
  // the current prescription (v1's era already has its own generated rows).
  return dailyTargets;
}

// ---------------------------------------------------------------------------
// Dense nutrition_events — one row per date over the window, mirroring the
// training-events window so the current week is dense. generateNutritionEvents
// reads the training events for surplus/training-day detection, so this must
// run AFTER insertTrainingEvents.
// ---------------------------------------------------------------------------

async function insertNutritionEvents(
  months: number,
  dailyTargets: Array<{
    day_of_week: string;
    calories: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    is_training_day: boolean;
  }>
) {
  console.log("Inserting dense nutrition_events via generateNutritionEvents()...");
  // Versioned model (migration 144): each era's events carry its OWN
  // version's id and prescription — v1's closed window first, then the open
  // version from its start through the forward horizon. The tenure window may
  // start after v1's era began; clamp so a short seed still splits correctly.
  const tenureStart = getDateDaysAgo(months * 30);
  const v1Until = getDateDaysAgo(91);
  const v2From = getDateDaysAgo(90);
  if (tenureStart <= v1Until) {
    await generateNutritionEvents(
      PERF_CLIENT_ID,
      PERF_NUTRITION_PLAN_V1_ID,
      { baselineCalories: 2300, proteinTargetG: 170, dietType: "balanced" },
      dailyTargets.map((t) => ({ ...t, calories: t.calories - 100 })),
      null, // trainingPlan — generateNutritionEvents fetches training events by date range
      expandDateRange(tenureStart, v1Until)
    );
  }
  await generateNutritionEvents(
    PERF_CLIENT_ID,
    PERF_NUTRITION_PLAN_ID,
    { baselineCalories: 2400, proteinTargetG: 170, dietType: "balanced" },
    dailyTargets,
    null,
    expandDateRange(v2From, getDateDaysFrom(new Date(), 8 * 7))
  );
}

// ---------------------------------------------------------------------------
// Training plan: 1 plan, 4 sessions, 6 exercises each
// ---------------------------------------------------------------------------

type PrescribedExercise = {
  id: string;
  trainingSessionId: string;
  exerciseId: string;
  name: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  rpeTarget: number;
  restSeconds: number;
};

async function insertTrainingPlan(
  exercises: Array<{ id: string; name: string }>,
  rng: Rng
): Promise<{
  sessionIds: Array<{ id: string; dayOfWeek: string; name: string; focus: string }>;
  exerciseRowsBySession: Map<string, PrescribedExercise[]>;
  hotExerciseId: string;
}> {
  console.log("Inserting training_plans + sessions + exercises...");

  const { error: planErr } = await supabaseAdmin.from("training_plans").insert({
    id: PERF_PLAN_ID,
    client_id: PERF_CLIENT_ID,
    coach_id: PERF_COACH_ID,
    name: "Perf seed plan",
    status: "active",
    coach_prompt: "Perf fixture plan: 4 sessions/week.",
    split_type: "upper_lower_full",
    frequency_per_week: 4,
    program_duration_weeks: 52,
  });
  if (planErr) throw new Error(`training_plans insert: ${planErr.message}`);

  const sessionRows = SESSION_TEMPLATES.map((s, idx) => ({
    id: deterministicUuid(`session-${idx}`),
    plan_id: PERF_PLAN_ID,
    name: s.name,
    day_of_week: s.dayOfWeek,
    focus: s.focus,
    order_index: s.orderIndex,
    is_active: true,
    estimated_duration_minutes: 60,
  }));
  const { error: sErr } = await supabaseAdmin.from("training_sessions").insert(sessionRows);
  if (sErr) throw new Error(`training_sessions insert: ${sErr.message}`);

  const exerciseRowsBySession = new Map<string, PrescribedExercise[]>();
  const exerciseInsertRows: Array<Record<string, unknown>> = [];

  for (const sessionRow of sessionRows) {
    const sessionExercises = exercises.slice(0, 6).map((e, idx) => {
      const teId = deterministicUuid(`te-${sessionRow.id}-${idx}`);
      const sets = rng.int(3, 5);
      const repsMin = rng.pick([5, 6, 8, 10]);
      const repsMax = repsMin + rng.int(2, 4);
      const rpeTarget = rng.pick([7, 7.5, 8, 8.5, 9]);
      const restSeconds = rng.pick([90, 120, 150, 180]);
      const out: PrescribedExercise = {
        id: teId,
        trainingSessionId: sessionRow.id,
        exerciseId: e.id,
        name: e.name,
        sets,
        repsMin,
        repsMax,
        rpeTarget,
        restSeconds,
      };
      return out;
    });

    exerciseRowsBySession.set(sessionRow.id, sessionExercises);

    for (let idx = 0; idx < sessionExercises.length; idx++) {
      const pe = sessionExercises[idx];
      exerciseInsertRows.push({
        id: pe.id,
        session_id: sessionRow.id,
        name: pe.name,
        sets: pe.sets,
        reps_min: pe.repsMin,
        reps_max: pe.repsMax,
        rpe_target: pe.rpeTarget,
        rest_seconds: pe.restSeconds,
        order_index: idx,
        is_active: true,
        exercise_id: pe.exerciseId,
      });
    }
  }

  const { error: eErr } = await supabaseAdmin
    .from("training_exercises")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(exerciseInsertRows as any);
  if (eErr) throw new Error(`training_exercises insert: ${eErr.message}`);

  const sessionIds = sessionRows.map((s) => ({
    id: s.id,
    dayOfWeek: s.day_of_week,
    name: s.name,
    focus: s.focus,
  }));

  // The "hot exercise" the harness uses for getExerciseProgressionSeries / getExercisePRs
  // is the first exercise (appears across all 4 sessions = max log count).
  const hotExerciseId = exercises[0].id;
  console.log(`  inserted ${sessionRows.length} sessions, ${exerciseInsertRows.length} exercises`);

  return { sessionIds, exerciseRowsBySession, hotExerciseId };
}

// ---------------------------------------------------------------------------
// Daily habits (5)
// ---------------------------------------------------------------------------

async function insertHabits() {
  console.log("Inserting 5 daily_habits...");
  const effectiveDate = getDateDaysAgo(365);
  const rows = HABIT_TEMPLATES.map((h, idx) => ({
    id: PERF_HABIT_IDS[idx],
    coach_id: PERF_COACH_ID,
    client_id: PERF_CLIENT_ID,
    name: h.name,
    is_boolean: h.isBoolean,
    is_active: true,
    sort_order: idx,
    target_value: h.target,
    target_unit: h.unit,
    effective_date: effectiveDate,
  }));
  const { error } = await supabaseAdmin.from("daily_habits").insert(rows);
  if (error) throw new Error(`daily_habits insert: ${error.message}`);
}

// ---------------------------------------------------------------------------
// daily_logs spine (one per day)
// ---------------------------------------------------------------------------

async function insertDailyLogsSpine(months: number): Promise<Map<string, string>> {
  const days = months * 30;
  console.log(`Inserting daily_logs spine (${days} days)...`);

  const rows: Array<{ id: string; client_id: string; date: string }> = [];
  for (let i = 0; i < days; i++) {
    const dateStr = getDateDaysAgo(days - 1 - i);
    rows.push({
      id: deterministicUuid(`dl-${dateStr}`),
      client_id: PERF_CLIENT_ID,
      date: dateStr,
    });
  }

  await insertInBatches("daily_logs", rows, 500);

  return new Map(rows.map((r) => [r.date, r.id]));
}

// ---------------------------------------------------------------------------
// wellness_logs, nutrition_logs, training_logs (1:1 with daily_logs)
// ---------------------------------------------------------------------------

async function insertDailyChildren(
  dailyLogIdsByDate: Map<string, string>,
  rng: Rng
) {
  console.log("Inserting wellness_logs, nutrition_logs, training_logs...");

  const wellness: Array<Record<string, unknown>> = [];
  const nutrition: Array<Record<string, unknown>> = [];
  const training: Array<Record<string, unknown>> = [];

  for (const [date, dailyLogId] of dailyLogIdsByDate) {
    wellness.push({
      daily_log_id: dailyLogId,
      client_id: PERF_CLIENT_ID,
      date,
      mood: rng.int(3, 5),
      energy: rng.int(5, 9),
      sleep: rng.int(5, 9),
      stress: rng.int(2, 6),
      // Max 6: deliberately below the high_soreness trigger threshold (8)
      soreness: rng.int(2, 6),
    });

    const targetCal = 2400;
    const consumed = targetCal + rng.int(-200, 200);
    nutrition.push({
      daily_log_id: dailyLogId,
      client_id: PERF_CLIENT_ID,
      date,
      calories_consumed: consumed,
      protein_g: 170 + rng.int(-20, 20),
      carbs_g: 280 + rng.int(-30, 30),
      fat_g: 70 + rng.int(-10, 10),
      target_calories: targetCal,
      target_protein_g: 170,
      target_carbs_g: 280,
      target_fat_g: 70,
      nutrition_adherence: rng.next() < 0.9 ? "hit" : "partial",
      calorie_surplus_deficit: consumed - targetCal,
      nutrition_plan_id: PERF_NUTRITION_PLAN_ID,
    });

    // trained=true on session days only (Mon/Tue/Thu/Sat)
    const dayIdx = new Date(date + "T00:00:00").getDay();
    const isSessionDay = [1, 2, 4, 6].includes(dayIdx);
    training.push({
      daily_log_id: dailyLogId,
      client_id: PERF_CLIENT_ID,
      date,
      trained: isSessionDay,
    });
  }

  await insertInBatches("wellness_logs", wellness, 500);
  await insertInBatches("nutrition_logs", nutrition, 500);
  await insertInBatches("training_logs", training, 500);
}

// ---------------------------------------------------------------------------
// session_logs → exercise_logs → set_logs
// ---------------------------------------------------------------------------

async function insertSessionLogsAndCompletions(
  sessionIds: Array<{ id: string; dayOfWeek: string; name: string; focus: string }>,
  exerciseRowsBySession: Map<string, PrescribedExercise[]>,
  args: Args,
  rng: Rng
) {
  console.log("Inserting session_logs, exercise_logs, set_logs...");

  const startDate = getDateDaysAgo(args.months * 30);
  const today = getTodayDateString();

  const sessionLogRows: Array<Record<string, unknown>> = [];

  const start = new Date(startDate + "T00:00:00");
  const end = new Date(today + "T00:00:00");

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayIdx = d.getDay();
    const session = sessionIds.find(
      (s) => DAY_NAME_TO_INDEX[s.dayOfWeek] === dayIdx
    );
    if (!session) continue;

    // 5% missed week — skip all sessions for this week if the week-hash falls in the band
    const isoWeekStart = getWeekStartString(d);
    if (weekIsMissed(isoWeekStart, args.seed)) continue;

    const dateStr = getDateString(d);
    const completionQuality = rng.next() < 0.92 ? "full" : "partial";
    sessionLogRows.push({
      id: deterministicUuid(`sl-${session.id}-${dateStr}`),
      client_id: PERF_CLIENT_ID,
      training_session_id: session.id,
      completed_at: dateStr + "T18:00:00.000Z",
      week_start_date: isoWeekStart,
      completion_quality: completionQuality,
      prescribed_session_snapshot: {
        name: session.name,
        day_of_week: session.dayOfWeek,
        focus: session.focus,
        estimated_duration_minutes: 60,
      },
    });
  }

  await insertInBatches("session_logs", sessionLogRows, 500);
  console.log(`  inserted ${sessionLogRows.length} session_logs`);

  // ---- exercise_logs ----
  const exerciseLogRows: Array<Record<string, unknown>> = [];
  const setRowsByLogId: Array<{ logId: string; sets: number }> = [];

  for (const sl of sessionLogRows) {
    const trainingSessionId = sl.training_session_id as string;
    const prescribed = exerciseRowsBySession.get(trainingSessionId) ?? [];
    for (const pe of prescribed) {
      const logId = deterministicUuid(`el-${sl.id}-${pe.id}`);
      exerciseLogRows.push({
        id: logId,
        session_log_id: sl.id,
        training_exercise_id: pe.id,
        exercise_id: pe.exerciseId,
        performed_name: pe.name,
        completed: true,
        prescribed_exercise_snapshot: {
          name: pe.name,
          sets: pe.sets,
          reps_min: pe.repsMin,
          reps_max: pe.repsMax,
          rpe_target: pe.rpeTarget,
          rest_seconds: pe.restSeconds,
        },
      });
      // Sets per exercise: deterministic-random 3-5
      const setCount = rng.int(3, 5);
      setRowsByLogId.push({ logId, sets: setCount });
    }
  }

  await insertInBatches("exercise_logs", exerciseLogRows, 500);
  console.log(`  inserted ${exerciseLogRows.length} exercise_logs`);

  // ---- set_logs ----
  // Build weight drift map: per training_exercise_id, a base weight per week.
  // Approximate the prescription: rep range 6-10 ~ moderate weights.
  const setLogRows: Array<Record<string, unknown>> = [];

  // exerciseLogRows index lookup for finding the underlying prescribed exercise
  const elById = new Map<string, Record<string, unknown>>();
  for (const el of exerciseLogRows) elById.set(el.id as string, el);

  const baseWeightByExercise = new Map<string, number>();

  for (const { logId, sets } of setRowsByLogId) {
    const el = elById.get(logId)!;
    const peId = el.training_exercise_id as string;
    if (!baseWeightByExercise.has(peId)) {
      baseWeightByExercise.set(peId, rng.int(60, 180)); // lbs starting weight
    }
    const base = baseWeightByExercise.get(peId)!;
    // monthly drift: pull date from session_log
    const sl = sessionLogRows.find((r) => r.id === el.session_log_id);
    const dateStr = (sl?.completed_at as string).slice(0, 10);
    const monthsSinceStart = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24 * 30);
    const drift = -monthsSinceStart * (base * 0.01); // 1%/month gain over time (older sessions lighter)
    const topSetWeight = Math.round((base + drift) / 2.5) * 2.5;

    for (let setNum = 1; setNum <= sets; setNum++) {
      // weight backs off slightly on later sets within a session
      const setWeight = setNum === 1 ? topSetWeight : Math.max(0, topSetWeight - (setNum - 1) * 5);
      const reps = rng.int(6, 10);
      const rpe = rng.pick([7, 7.5, 8, 8.5, 9, 9.5]);
      setLogRows.push({
        exercise_log_id: logId,
        set_number: setNum,
        reps,
        weight: setWeight,
        rpe,
      });
    }
  }

  await insertInBatches("set_logs", setLogRows, 1000);
  console.log(`  inserted ${setLogRows.length} set_logs`);
}

// ---------------------------------------------------------------------------
// daily_habit_logs (5 habits × N days)
// ---------------------------------------------------------------------------

async function insertHabitLogs(months: number, rng: Rng) {
  console.log("Inserting daily_habit_logs...");
  const days = months * 30;
  const rows: Array<Record<string, unknown>> = [];
  for (const habitId of PERF_HABIT_IDS) {
    const isBoolean = HABIT_TEMPLATES[PERF_HABIT_IDS.indexOf(habitId)].isBoolean;
    for (let i = 0; i < days; i++) {
      const dateStr = getDateDaysAgo(days - 1 - i);
      const completed = rng.next() < 0.9;
      rows.push({
        daily_habit_id: habitId,
        client_id: PERF_CLIENT_ID,
        date: dateStr,
        completed,
        value: isBoolean ? null : rng.int(1, 4),
      });
    }
  }
  await insertInBatches("daily_habit_logs", rows, 1000);
  console.log(`  inserted ${rows.length} daily_habit_logs`);
}

// ---------------------------------------------------------------------------
// check_ins (52 weekly Sundays)
// ---------------------------------------------------------------------------

type CheckInRow = { id: string; created_at: string };

async function insertCheckIns(months: number, rng: Rng): Promise<CheckInRow[]> {
  console.log("Inserting check_ins (weekly)...");
  const days = months * 30;
  const rows: Array<Record<string, unknown>> = [];
  // anchor to a Sunday near the start of the window
  for (let i = 0; i < Math.floor(days / 7); i++) {
    const dateStr = getDateDaysAgo(days - 1 - i * 7);
    rows.push({
      id: deterministicUuid(`ci-${dateStr}`),
      client_id: String(PERF_CLIENT_ID),
      status: "reviewed",
      mood: rng.int(3, 5),
      energy: rng.int(5, 9),
      sleep: rng.int(5, 9),
      stress: rng.int(2, 6),
      soreness: rng.int(2, 6),
      // Canonical kg/cm. Was 185 lb ramping by 0.2 lb and 34/40/42/14/24 in.
      weight: 83.9 - i * 0.09,
      body_fat_percentage: 22 - i * 0.05,
      waist: 86.4 - i * 0.13,
      hips: 101.6,
      chest: 106.7,
      arms: 35.6,
      thighs: 61,
      adherence_percentage: rng.int(70, 100),
      workouts_completed: rng.int(2, 4),
      created_at: dateStr + "T12:00:00.000Z",
    });
  }
  await insertInBatches("check_ins", rows, 500);
  console.log(`  inserted ${rows.length} check_ins`);

  return rows.map((r) => ({ id: r.id as string, created_at: r.created_at as string }));
}

// ---------------------------------------------------------------------------
// body_metrics (12 monthly, source_id → nearest check_in)
// ---------------------------------------------------------------------------

async function insertBodyMetrics(checkIns: CheckInRow[], rng: Rng) {
  console.log("Inserting body_metrics (monthly)...");
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 12; i++) {
    const monthAgo = 11 - i; // 0..11
    const dateStr = getDateDaysAgo(monthAgo * 30);
    // find nearest check_in by date
    const nearest = nearestCheckIn(checkIns, dateStr);
    rows.push({
      client_id: PERF_CLIENT_ID,
      weight: 83.9 - i * 0.23 + rng.next() - 0.5, // kg; was 185 lb ramping by 0.5 lb
      body_fat_percentage: 22 - i * 0.2 + rng.next() * 0.5,
      source: "check_in",
      source_id: nearest?.id ?? null,
      recorded_at: dateStr + "T12:00:00.000Z",
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabaseAdmin.from("body_metrics").insert(rows as any);
  if (error) throw new Error(`body_metrics insert: ${error.message}`);
  console.log(`  inserted ${rows.length} body_metrics`);
}

function nearestCheckIn(checkIns: CheckInRow[], dateStr: string): CheckInRow | null {
  if (checkIns.length === 0) return null;
  const target = new Date(dateStr).getTime();
  let best = checkIns[0];
  let bestDist = Math.abs(new Date(best.created_at).getTime() - target);
  for (const ci of checkIns) {
    const d = Math.abs(new Date(ci.created_at).getTime() - target);
    if (d < bestDist) {
      best = ci;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// training_events via generateTrainingEvents()
// ---------------------------------------------------------------------------

async function insertTrainingEvents(
  sessionIds: Array<{ id: string; dayOfWeek: string; name: string; focus: string }>,
  months: number
) {
  console.log("Inserting training_events via generateTrainingEvents()...");
  // Extend 8 weeks into the future so the current Mon-Sun week always has all
  // 4 sessions present — otherwise "this week's nutrition" shows fewer training
  // days as time advances past the day the seed was last run. Matches the
  // 8-week buffer used by scripts/backfill-training-events.ts.
  await generateTrainingEvents(
    PERF_CLIENT_ID,
    PERF_PLAN_ID,
    sessionIds.map((s) => ({
      id: s.id,
      name: s.name,
      dayOfWeek: s.dayOfWeek,
      focus: s.focus,
      estimatedCalories: 400,
      // Exercise the percentage-surplus model (not the legacy flat-400 path) so
      // generated nutrition events carry a real surplus % and the surplus-split
      // toggle is observable in-app. Lands on training_events.calorie_surplus_percentage.
      calorieSurplusPercentage: 15,
    })),
    getDateDaysAgo(months * 30),
    getDateDaysFrom(new Date(), 8 * 7)
  );
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

async function insertInBatches(
  table: string,
  rows: Array<Record<string, unknown>>,
  batchSize: number
) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    // The supabase-js typed Database schema can't accept a dynamic table name +
    // dynamic row shape; this is a seed fixture script so we widen at the call site.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin.from(table as any).insert as any)(batch);
    if (error) {
      throw new Error(
        `${table} batch insert (rows ${i}..${i + batch.length}): ${error.message}`
      );
    }
    if (rows.length > batchSize) {
      console.log(`  ${table}: ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers: deterministic UUID, week math, hash
// ---------------------------------------------------------------------------

// Deterministic UUID v4-ish from a string seed. Used for stable fixture row IDs
// keyed on (date, table). Not cryptographically random — fine for fixtures.
function deterministicUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 2246822507) >>> 0;
  }
  // Spread the two 32-bit hashes across the 128 UUID bits via repeated mixing.
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const h3 = Math.imul(h1 ^ h2, 1597334677) >>> 0;
  const h4 = Math.imul(h2 ^ h3, 374761393) >>> 0;
  let s = hex(h1) + hex(h2) + hex(h3) + hex(h4);
  // Force version 4 + variant bits.
  s = s.slice(0, 12) + "4" + s.slice(13, 16) + "8" + s.slice(17);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function getWeekStartString(date: Date): string {
  // Monday of the week containing date
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return getDateString(d);
}

function weekIsMissed(weekStart: string, seed: number): boolean {
  // Deterministic per-week roll. Keep `h` unsigned at every step so the final
  // modulo can't go negative (which would skip ~50% of weeks instead of 5%).
  let h = seed >>> 0;
  for (let i = 0; i < weekStart.length; i++) {
    h = (Math.imul(h, 31) + weekStart.charCodeAt(i)) >>> 0;
  }
  return h % 100 < 5;
}

// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
