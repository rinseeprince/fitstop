/**
 * Request-level proof that a check-in's review reads the check-in's day
 * (docs/MEASUREMENT-LOG-PLAN.md commit 8b), against the linked DEV database
 * through a running `next dev`.
 *
 *   npx tsx scripts/check-in-as-of-proof.ts
 *
 * Two subjects, both read through GET /api/check-in/[id]/comparison as the
 * coach with a minted session, every expectation computed from the database
 * rather than from the functions under test:
 *
 *   A  Sam Kalepa's 31 May check-in — real DEV history. Its stamped weight is
 *      80; two coach entries dated the same day were written in September (the
 *      day's standing value is 72) and today's reading is 85. It is older than
 *      every goal. So: the strip's reading is the stamped 80, not 72 and not
 *      85; the page shows no goal and `goalIsCurrent` is false; the nutrition
 *      version covering 31 May is a legacy `archived` row, so no base weight.
 *
 *   B  A throwaway client under the owner's coach row, deleted at the end:
 *      goal 1 from two days ago → check-in B yesterday, inside it → goal 2
 *      from today → check-in C today, inside that. B reads goal 1, its
 *      deadline and days remaining from B's day, and its progress from the
 *      reading on goal 1's start day, with the flag false; C reads goal 2 with
 *      the flag true. C's stamped weight is above every earlier one, so the
 *      trend for B reads "losing" only while the read stops at B — drop the
 *      bound and it flips. Two earlier check-ins, A (stamped) and W
 *      (weightless), predate goal 1 and read no goal; W's reading is the coach
 *      entry before its day, not the removed one dated a day later. Two
 *      nutrition versions prove the base weight follows the check-in's day: B
 *      and W read the first, C the second.
 *
 * Every fixture number is distinct. The throwaway's readings and goals go with
 * the client (ON DELETE CASCADE); its check-ins are deleted first, since
 * `check_ins.client_id` is TEXT with no foreign key.
 */
import "./env-bootstrap";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { voidMeasurement } from "@/services/measurement-edits-service";
import { addGoal } from "@/services/client-goal-writes-service";
import { GOAL_TYPE_SETTINGS } from "@/lib/goals/goal-types";
import { addDaysToDateString, differenceInDays, getTodayDateStringInTimezone } from "@/lib/date-helpers";

const BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";
const COACH_EMAIL = "samuel.k@taboola.com";
const SAM = "f87bee53-0974-46d3-b1fb-34c14af6a8b5";

const SUPABASE_URL = need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
const ANON_KEY = need("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

type Session = { cookie: string };

async function mintSession(email: string): Promise<Session> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.email_otp) {
    throw new Error(`generateLink failed for ${email}: ${linkError?.message ?? "no otp"}`);
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError || !verified.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyError?.message ?? "no session"}`);
  }
  const jar = new Map<string, string>();
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error: setError } = await ssr.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (setError) throw new Error(`setSession failed for ${email}: ${setError.message}`);
  return { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}

type GoalRow = { goal?: number; startingWeight?: number; startingBodyFat?: number; position: { current: number; isOnTrack: boolean; paceStatus?: string } | null };
type Comparison = {
  comparison: {
    client: {
      goalWeight?: number;
      goalDeadline?: string;
      currentWeight?: number;
      currentBodyFatPercentage?: number;
      nutritionPlanBaseWeightKg?: number;
      nutritionPlanEffectiveDate?: string;
    };
  };
  goalProgress: {
    weight?: GoalRow;
    bodyFat?: GoalRow;
    deadline?: { date: string; daysRemaining: number; isPastDeadline: boolean };
    goalIsCurrent: boolean;
  };
};

async function comparisonOf(session: Session, checkInId: string): Promise<{ status: number; body: Comparison }> {
  const res = await fetch(`${BASE}/api/check-in/${checkInId}/comparison`, {
    headers: { Cookie: session.cookie, Origin: BASE, Accept: "application/json" },
  });
  const text = await res.text();
  let body: Comparison;
  try {
    body = JSON.parse(text) as Comparison;
  } catch {
    throw new Error(`comparison ${checkInId} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
}

/** The live rows of one metric on or before a day, newest first, for the expectation. */
async function readingsOnOrBefore(clientId: string, metric: "weight" | "bodyFat", day: string) {
  const { data, error } = await supabaseAdmin
    .from("client_measurements_live")
    .select("id, value, recorded_on, recorded_at, source, source_id")
    .eq("client_id", clientId)
    .eq("metric_key", metric)
    .lte("recorded_on", day)
    .order("recorded_on", { ascending: false })
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function currentValue(clientId: string, metric: "weight" | "bodyFat"): Promise<number | undefined> {
  const { data, error } = await supabaseAdmin
    .from("client_current_measurements")
    .select("value")
    .eq("client_id", clientId)
    .eq("metric_key", metric)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value == null ? undefined : Number(data.value);
}

/**
 * The goal in force on a day — the latest to start on or before it — with
 * that day's deadline — the newest entry on or before it — from the raw rows,
 * in JS.
 */
async function goalInForce(clientId: string, day: string) {
  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .select("id, target_weight, starts_on, client_goal_deadlines(effective_on, deadline)")
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  const [goal] = (data ?? [])
    .filter((row) => row.starts_on <= day)
    .sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1));
  if (!goal) return undefined;
  const [entry] = (goal.client_goal_deadlines ?? [])
    .filter((row) => row.effective_on <= day)
    .sort((a, b) => (a.effective_on < b.effective_on ? 1 : -1));
  return {
    id: goal.id,
    targetWeight: goal.target_weight == null ? undefined : Number(goal.target_weight),
    startsOn: goal.starts_on,
    deadline: entry?.deadline ?? undefined,
  };
}

async function coveringVersion(clientId: string, day: string) {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, base_weight_kg, effective_from, effective_until, status")
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("effective_from", day)
    .or(`effective_until.is.null,effective_until.gte.${day}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const coachSession = await mintSession(COACH_EMAIL);

  // ---------------------------------------------------------------------------
  console.info("A. Sam Kalepa's 31 May check-in — real DEV history");
  const { data: sam, error: samError } = await supabaseAdmin
    .from("clients")
    .select("id, timezone")
    .eq("id", SAM)
    .single();
  if (samError || !sam) throw new Error(`Sam not found: ${samError?.message}`);
  const { data: mayRows, error: mayError } = await supabaseAdmin
    .from("check_ins")
    .select("id, created_at")
    .eq("client_id", SAM)
    .gte("created_at", "2026-05-31")
    .lt("created_at", "2026-06-01")
    .order("created_at", { ascending: true })
    .limit(1);
  if (mayError || !mayRows?.[0]?.created_at) throw new Error(`31 May check-in not found: ${mayError?.message}`);
  const may = { id: mayRows[0].id, createdAt: mayRows[0].created_at };
  const mayDay = getTodayDateStringInTimezone(sam.timezone, new Date(may.createdAt));

  const { data: stampedRows } = await supabaseAdmin
    .from("client_measurements_live")
    .select("metric_key, value")
    .eq("source_id", may.id);
  const stamped = Object.fromEntries((stampedRows ?? []).map((r) => [r.metric_key, Number(r.value)]));
  const dayWeights = await readingsOnOrBefore(SAM, "weight", mayDay);
  const dayValue = dayWeights.find((r) => r.recorded_on === mayDay);
  const nowWeight = await currentValue(SAM, "weight");
  const goalThen = await goalInForce(SAM, mayDay);
  const planThen = await coveringVersion(SAM, mayDay);

  const a = await comparisonOf(coachSession, may.id);
  check("GET comparison → 200", a.status === 200, a.status);
  check(
    `the strip's reading is the check-in's own stamped weight (${stamped.weight}), not the day's standing value (${dayValue?.value}) and not today's (${nowWeight})`,
    a.body.comparison.client.currentWeight === stamped.weight &&
      stamped.weight !== Number(dayValue?.value) &&
      stamped.weight !== nowWeight,
    { wire: a.body.comparison.client.currentWeight, stamped, dayValue: dayValue?.value, nowWeight }
  );
  check(
    `body fat likewise (${stamped.bodyFat})`,
    a.body.comparison.client.currentBodyFatPercentage === stamped.bodyFat,
    a.body.comparison.client.currentBodyFatPercentage
  );
  check(
    "no goal was in force on 31 May, and the page shows no goal — goalIsCurrent false, no rows, no goal on the wire",
    goalThen === undefined &&
      a.body.goalProgress.goalIsCurrent === false &&
      a.body.goalProgress.weight === undefined &&
      a.body.goalProgress.bodyFat === undefined &&
      a.body.goalProgress.deadline === undefined &&
      a.body.comparison.client.goalWeight === undefined,
    { goalThen, goalProgress: a.body.goalProgress, goalWeight: a.body.comparison.client.goalWeight }
  );
  check(
    "the nutrition version covering 31 May is not an active one (legacy archived), so the wire carries no base weight",
    planThen === null && a.body.comparison.client.nutritionPlanBaseWeightKg === undefined,
    { planThen, base: a.body.comparison.client.nutritionPlanBaseWeightKg }
  );
  check(
    "the payload's shape: comparison + goalProgress, goalProgress keys within {weight, bodyFat, deadline, goalIsCurrent}",
    Object.keys(a.body).sort().join(",") === "comparison,goalProgress" &&
      Object.keys(a.body.goalProgress).every((k) => ["weight", "bodyFat", "deadline", "goalIsCurrent"].includes(k)),
    Object.keys(a.body.goalProgress)
  );

  // ---------------------------------------------------------------------------
  console.info("B. A throwaway client: two goals, four check-ins, two nutrition versions");
  const stamp = Date.now();
  // A real zone, not the 'UTC' sentinel the server resolves through the
  // coach's zone: the goals are days on the client's calendar, and this proof
  // and the server must read the same calendar.
  const zone = "Europe/London";
  const today = getTodayDateStringInTimezone(zone);
  const d = (offset: number) => addDaysToDateString(today, offset);
  const { data: created, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coach.id,
      name: "As-of proof",
      email: `as-of-proof-${stamp}@fixture.local`,
      active: true,
      user_id: null,
      start_date: d(-14),
      timezone: zone,
      onboarding_status: "active",
      height: 175,
      gender: "female",
      date_of_birth: "1992-03-04",
    } as never)
    .select("id")
    .single();
  if (clientError || !created) throw new Error(`Client insert failed: ${clientError?.message}`);
  const C = created.id;

  const A_ID = `a0000000-0000-4000-8000-${stamp.toString().slice(-12).padStart(12, "0")}`;
  const W_ID = `b0000000-0000-4000-8000-${stamp.toString().slice(-12).padStart(12, "0")}`;
  const B_ID = `c0000000-0000-4000-8000-${stamp.toString().slice(-12).padStart(12, "0")}`;
  const C_ID = `d0000000-0000-4000-8000-${stamp.toString().slice(-12).padStart(12, "0")}`;

  const insertCheckIn = async (row: { id: string; created_at: string; period_start: string; period_end: string }) => {
    const { error } = await supabaseAdmin
      .from("check_ins")
      .insert({ client_id: String(C), status: "reviewed", ...row } as never);
    if (error) throw new Error(`check-in insert failed: ${error.message}`);
  };

  try {
    // The readings before goal 1: the baseline (intake, D-14), A's stamped
    // 86 (D-7), a coach entry 85 (D-5), and a coach entry 83 (D-4) removed.
    await appendMeasurements({ clientId: C, source: "intake", recordedOn: d(-14), values: { weight: 90 } });
    await insertCheckIn({ id: A_ID, created_at: `${d(-7)}T12:00:00+00:00`, period_start: d(-13), period_end: d(-7) });
    await appendMeasurements({ clientId: C, source: "check_in", sourceId: A_ID, recordedOn: d(-7), measuredAt: `${d(-7)}T12:00:00+00:00`, values: { weight: 86 } });
    await appendMeasurements({ clientId: C, source: "coach_entry", recordedOn: d(-5), values: { weight: 85 }, createdBy: coach.id });
    const removed = (await appendMeasurements({ clientId: C, source: "coach_entry", recordedOn: d(-4), values: { weight: 83 }, createdBy: coach.id })).rows.weight!;
    await voidMeasurement({ clientId: C, measurementId: removed.id, actor: coach.id });
    await insertCheckIn({ id: W_ID, created_at: `${d(-3)}T12:00:00+00:00`, period_start: d(-9), period_end: d(-3) });

    // Two nutrition versions: [D-30, D-1] at base 87, [D, D+56] at base 82.
    const shared = {
      client_id: C,
      coach_id: coach.id,
      name: "As-of proof plan",
      status: "active",
      work_activity_level: "moderately_active",
      training_volume_hours: "3-5",
      protein_target_g_per_kg: 2.0,
      diet_type: "balanced",
      protein_target_g: 150,
      carb_target_g: 200,
      fat_target_g: 60,
      bmr: 1400,
      tdee: 2100,
    };
    const { error: planError } = await supabaseAdmin.from("nutrition_plans").insert([
      { ...shared, effective_from: d(-30), effective_until: d(-1), base_weight_kg: 87, baseline_calories: 2000 },
      { ...shared, effective_from: today, effective_until: d(56), base_weight_kg: 82, baseline_calories: 1800 },
    ] as never);
    if (planError) throw new Error(`nutrition_plans insert failed: ${planError.message}`);

    // Goal 1 from D-2, then B inside it (D-1), then goal 2 from today, then C
    // inside that. Each goal is set on its own start day, handed to the
    // function as its today: it refuses a start before the today it is given.
    const goal1Starts = d(-2);
    const goal1 = await addGoal({
      clientId: C,
      today: goal1Starts,
      startsOn: goal1Starts,
      source: "coach",
      setBy: coach.id,
      type: "lose_weight",
      name: GOAL_TYPE_SETTINGS.lose_weight.name,
      targetWeight: 80,
      targetBodyFatPercentage: null,
      description: null,
      deadline: d(30),
    });
    const bDay = d(-1);
    const bAt = `${bDay}T12:00:00+00:00`;
    await insertCheckIn({ id: B_ID, created_at: bAt, period_start: d(-2), period_end: bDay });
    await appendMeasurements({ clientId: C, source: "check_in", sourceId: B_ID, recordedOn: bDay, measuredAt: bAt, values: { weight: 84 } });
    const goal2 = await addGoal({
      clientId: C,
      today,
      startsOn: today,
      source: "coach",
      setBy: coach.id,
      type: "lose_weight",
      name: GOAL_TYPE_SETTINGS.lose_weight.name,
      targetWeight: 75,
      targetBodyFatPercentage: null,
      description: null,
      deadline: d(60),
    });
    const cAt = new Date().toISOString();
    await insertCheckIn({ id: C_ID, created_at: cAt, period_start: d(1), period_end: d(7) });
    await appendMeasurements({ clientId: C, source: "check_in", sourceId: C_ID, recordedOn: today, measuredAt: cAt, values: { weight: 91 } });

    const goalOnB = await goalInForce(C, bDay);
    const goalOnC = await goalInForce(C, today);
    check(
      "setup: goal 1 is in force on B's day and goal 2 on C's, today",
      goal1 !== goal2 && goalOnB?.id === goal1 && goalOnC?.id === goal2,
      { goal1, goal2, goalOnB, goalOnC }
    );
    const nowC = await currentValue(C, "weight");
    check("setup: the Overview's 'now' for the throwaway is C's 91 — the reading written last today", nowC === 91, nowC);
    const [startThen] = await readingsOnOrBefore(C, "weight", goal1Starts);

    console.info("B1. Check-in B, inside goal 1");
    const b = await comparisonOf(coachSession, B_ID);
    check("→ 200", b.status === 200, b.status);
    check(
      `the goal is goal 1's ${goalOnB?.targetWeight} with its deadline ${goalOnB?.deadline}, not goal 2's ${goalOnC?.targetWeight}`,
      b.body.goalProgress.weight?.goal === goalOnB?.targetWeight &&
        b.body.goalProgress.deadline?.date === goalOnB?.deadline &&
        b.body.comparison.client.goalWeight === goalOnB?.targetWeight,
      { goal: b.body.goalProgress.weight?.goal, deadline: b.body.goalProgress.deadline }
    );
    check(
      "days remaining are counted from B's day",
      b.body.goalProgress.deadline?.daysRemaining ===
        differenceInDays(new Date(`${goalOnB?.deadline}T00:00:00`), new Date(`${bDay}T00:00:00`)),
      b.body.goalProgress.deadline
    );
    check("goalIsCurrent is false — goal 1 has been replaced", b.body.goalProgress.goalIsCurrent === false, b.body.goalProgress.goalIsCurrent);
    check("the position is B's own stamped 84, not today's 91", b.body.goalProgress.weight?.position?.current === 84 && b.body.comparison.client.currentWeight === 84, b.body.goalProgress.weight?.position);
    check(
      `the start is the reading on goal 1's start day (${startThen?.value}) — the coach entry before it, not the removed 83 and not the baseline 90`,
      Number(startThen?.value) === 85 && b.body.goalProgress.weight?.startingWeight === Number(startThen?.value),
      { wire: b.body.goalProgress.weight?.startingWeight, expected: startThen }
    );
    check("the trend stops at B: 86 → 84 reads losing, towards 80 — with C's later 91 in the set it would read gaining", b.body.goalProgress.weight?.position?.isOnTrack === true, b.body.goalProgress.weight?.position);
    check("the drift note reads the version covering B's day: base 87", b.body.comparison.client.nutritionPlanBaseWeightKg === 87 && b.body.comparison.client.nutritionPlanEffectiveDate === d(-30), b.body.comparison.client);

    console.info("B2. Check-in C, inside the current goal 2");
    const c = await comparisonOf(coachSession, C_ID);
    check("→ 200", c.status === 200, c.status);
    check(
      `the goal is goal 2's ${goalOnC?.targetWeight} with its deadline ${goalOnC?.deadline}`,
      c.body.goalProgress.weight?.goal === goalOnC?.targetWeight && c.body.goalProgress.deadline?.date === goalOnC?.deadline,
      { goal: c.body.goalProgress.weight?.goal, deadline: c.body.goalProgress.deadline }
    );
    check("goalIsCurrent is true — the goal judged is the one in force today", c.body.goalProgress.goalIsCurrent === true, c.body.goalProgress.goalIsCurrent);
    check("the position is C's stamped 91", c.body.goalProgress.weight?.position?.current === 91, c.body.goalProgress.weight?.position);
    check("the drift note reads the version covering C's day: base 82, effective today", c.body.comparison.client.nutritionPlanBaseWeightKg === 82 && c.body.comparison.client.nutritionPlanEffectiveDate === today, c.body.comparison.client);

    console.info("B3. Check-in W, weightless, before any goal");
    const expectedW = (await readingsOnOrBefore(C, "weight", d(-3)))[0];
    const w = await comparisonOf(coachSession, W_ID);
    check("→ 200", w.status === 200, w.status);
    check("the reading then is the coach entry before its day (85) — not the removed 83 dated a day later, not A's older 86, not the later rows", w.body.comparison.client.currentWeight === 85 && Number(expectedW?.value) === 85, { wire: w.body.comparison.client.currentWeight, expected: expectedW });
    check("no goal was in force then: no goal on the page", (await goalInForce(C, d(-3))) === undefined && w.body.goalProgress.goalIsCurrent === false && w.body.goalProgress.weight === undefined, w.body.goalProgress);
    check("the drift note reads the version covering W's day: base 87", w.body.comparison.client.nutritionPlanBaseWeightKg === 87 && w.body.comparison.client.nutritionPlanEffectiveDate === d(-30), w.body.comparison.client);

    console.info("B4. Check-in A, stamped, before any goal");
    const aa = await comparisonOf(coachSession, A_ID);
    check("→ 200 and the reading then is A's own stamped 86", aa.status === 200 && aa.body.comparison.client.currentWeight === 86, aa.body.comparison.client);
    check("no goal on the page", aa.body.goalProgress.goalIsCurrent === false && aa.body.goalProgress.weight === undefined, aa.body.goalProgress);
  } finally {
    console.info("Teardown");
    const { error: ciError } = await supabaseAdmin.from("check_ins").delete().eq("client_id", String(C));
    if (ciError) console.error(`  check-ins not deleted: ${ciError.message}`);
    const { error: planError } = await supabaseAdmin.from("nutrition_plans").delete().eq("client_id", C);
    if (planError) console.error(`  nutrition versions not deleted: ${planError.message}`);
    const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", C);
    if (auditError) console.error(`  audit rows not deleted: ${auditError.message}`);
    const { error: clientError2 } = await supabaseAdmin.from("clients").delete().eq("id", C);
    if (clientError2) console.error(`  client not deleted: ${clientError2.message}`);
    const { count } = await supabaseAdmin
      .from("client_measurements")
      .select("id", { count: "exact", head: true })
      .eq("client_id", C);
    check("the throwaway readings went with the client", count === 0, count);
    const { count: goalCount } = await supabaseAdmin
      .from("client_goals")
      .select("id", { count: "exact", head: true })
      .eq("client_id", C);
    check("the throwaway goals went with the client", goalCount === 0, goalCount);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.info("\nAll checks passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
