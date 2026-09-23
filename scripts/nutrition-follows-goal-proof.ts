/**
 * Proof that nutrition follows the goal (docs/MEASUREMENT-LOG-PLAN.md §6 commit
 * 8d1, second commit) against the linked DEV database through a running
 * `next dev`:
 *
 *   npx tsx scripts/nutrition-follows-goal-proof.ts
 *
 * Part 1 — every DEV client with a version that has a day left: the out-of-date
 * rule's answer beside the check it replaces (the latest-saved version against
 * the goal on the client's today), so every change in what a coach is told is
 * listed and explained. Read-only.
 *
 * Part 2 — the routes, end to end, on one throwaway client under the owner's
 * coach, removed at the end with everything it made (ON DELETE CASCADE) and its
 * audit rows. Every fixture number is distinct.
 *
 *   1  the day read answers the goal in force on the asked day — today's, then
 *      the planned goal's inside it — with the calculator's inputs for it
 *   2  a plan saved from today is built for today's goal, and the rule says it
 *      is out of date from the planned goal's first day, and not before
 *   3  a plan saved from that day is built for the planned goal — the preview
 *      and the save agree — and nothing is out of date any more
 *   4  another coach's client is 404 on both reads; a malformed day is 400
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { addGoal } from "@/services/client-goal-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { getGoalForDate } from "@/services/client-goals-service";
import { getLatestNutritionPlan, getNutritionPlanForDate } from "@/services/nutrition-plan-service";
import { getNutritionOutOfDate } from "@/services/nutrition-goal-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
import { detectGoalDrift } from "@/lib/goals/detect-goal-drift";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { NutritionGoalForDay, NutritionOutOfDateRead } from "@/types/nutrition-goal";
import { mintSession, send } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700));
  }
}

async function partOne(): Promise<void> {
  console.info("Part 1 — every DEV client with a version that has a day left");
  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("client_id")
    .eq("status", "active")
    .gte("effective_until", addDaysToDateString(new Date().toISOString().slice(0, 10), -1));
  if (error) throw new Error(error.message);
  const clientIds = [...new Set((rows ?? []).map((row) => row.client_id))];

  let flaggedNow = 0;
  let flaggedBefore = 0;
  const changes: string[] = [];
  for (const clientId of clientIds) {
    const today = await getClientTodayString(clientId);
    const [answer, latest, covering, goal] = await Promise.all([
      getNutritionOutOfDate(clientId),
      getLatestNutritionPlan(clientId),
      getNutritionPlanForDate(clientId, today),
      getGoalForDate(clientId, today),
    ]);
    const seed = latest ?? covering;
    const before = seed
      ? detectGoalDrift(
          { goalWeightKg: seed.goal_weight_kg == null ? null : Number(seed.goal_weight_kg), deadline: seed.goal_deadline },
          resolveEffectiveGoal(goal)
        ).changed
      : false;
    const now = answer.outOfDate !== null;
    if (now) flaggedNow += 1;
    if (before) flaggedBefore += 1;
    const line = `${clientId.slice(0, 8)} before=${before ? "flagged" : "—"} now=${
      now ? `from ${answer.outOfDate?.fromDay} (${JSON.stringify(answer.outOfDate?.built)} → ${JSON.stringify(answer.outOfDate?.goal)})` : "—"
    }`;
    console.info(`  ${line}`);
    if (before !== now || (now && answer.outOfDate?.fromDay !== today)) changes.push(line);
  }
  console.info(
    `  ${clientIds.length} clients · flagged by the old check: ${flaggedBefore} · by the rule: ${flaggedNow} · changed: ${changes.length}`
  );
  for (const line of changes) console.info(`    changed: ${line}`);
}

async function partTwo(): Promise<void> {
  console.info("Part 2 — the routes on a throwaway client");
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coach.id,
      name: "Nutrition follows goal proof",
      email: `nutrition-goal-proof-${Date.now()}@fixture.local`,
      gender: "male",
      height: 181,
      date_of_birth: "1991-04-17",
      bmr: 1862,
      tdee: 2547,
    } as never)
    .select("id")
    .single();
  if (clientError || !client) throw new Error(`client insert: ${clientError?.message}`);
  const C: string = client.id;

  try {
    const today = await getClientTodayString(C);
    const day = (n: number) => addDaysToDateString(today, n);
    const plannedFrom = day(30);
    await appendMeasurements({ clientId: C, source: "coach_entry", recordedOn: today, values: { weight: 87.3 }, createdBy: coach.id });
    await addGoal({
      clientId: C, today, startsOn: today, source: "coach", setBy: coach.id,
      type: "lose_weight", name: "Lean out", targetWeight: 81.9, targetBodyFatPercentage: null,
      description: null, deadline: day(27),
    });
    await addGoal({
      clientId: C, today, startsOn: plannedFrom, source: "coach", setBy: coach.id,
      type: "build_muscle", name: "Build", targetWeight: 84.6, targetBodyFatPercentage: null,
      description: null, deadline: day(150),
    });

    const session = await mintSession(COACH_EMAIL, "coach");
    const base = `/api/clients/${C}/nutrition`;
    const dayRead = async (date: string) => {
      const res = await send(session, "GET", `${base}/goal?date=${date}`);
      return { status: res.status, data: (res.json as { data: NutritionGoalForDay }).data };
    };
    const outOfDate = async () => {
      const res = await send(session, "GET", `${base}/goal/out-of-date`);
      return { status: res.status, data: (res.json as { data: NutritionOutOfDateRead }).data };
    };

    console.info("1. The day read answers the goal in force on the asked day");
    const onToday = await dayRead(today);
    check(
      "today: Lean out, priced 81.9 kg by its deadline",
      onToday.status === 200 && onToday.data.goal?.name === "Lean out" &&
        onToday.data.calcInputs.status === "ready" && onToday.data.calcInputs.goalWeightKg === 81.9 &&
        onToday.data.calcInputs.goalDeadline === day(27),
      onToday
    );
    const insidePlanned = await dayRead(day(35));
    check(
      "inside the planned goal: Build, priced 84.6 kg by its deadline",
      insidePlanned.status === 200 && insidePlanned.data.goal?.name === "Build" &&
        insidePlanned.data.calcInputs.status === "ready" && insidePlanned.data.calcInputs.goalWeightKg === 84.6 &&
        insidePlanned.data.calcInputs.goalDeadline === day(150),
      insidePlanned
    );

    const settings = { proteinTargetGPerKg: 2, dietType: "balanced" as const, trainingVolumeHours: "2-3" as const };
    const save = (effectiveFrom: string) =>
      send(session, "POST", base, { ...settings, effectiveFrom, includeActivityBurn: true, surplusAsCarbs: false });

    console.info("2. A plan from today is out of date from the planned goal's first day");
    const fromToday = await save(today);
    check("the save lands", fromToday.status === 200, fromToday.text.slice(0, 300));
    const { data: versionToday } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id, goal_weight_kg, goal_deadline, effective_until")
      .eq("client_id", C)
      .eq("effective_from", today)
      .single();
    check(
      "built for today's goal",
      Number(versionToday?.goal_weight_kg) === 81.9 && versionToday?.goal_deadline === day(27),
      versionToday
    );
    const afterToday = await outOfDate();
    check(
      `out of date from ${plannedFrom}, not before`,
      afterToday.status === 200 && afterToday.data.outOfDate?.fromDay === plannedFrom &&
        afterToday.data.outOfDate?.versionId === versionToday?.id &&
        afterToday.data.outOfDate?.goal.goalWeightKg === 84.6,
      afterToday
    );

    console.info("3. A plan from that day is built for the planned goal, as previewed");
    const preview = insidePlanned.data.calcInputs;
    const onPlannedDay = await dayRead(plannedFrom);
    const inputs = onPlannedDay.data.calcInputs;
    if (inputs.status !== "ready" || preview.status !== "ready") throw new Error("inputs not ready");
    const previewed = generateNutritionPlan({ ...inputs, ...settings, trainingPlan: null, startDate: plannedFrom });
    const fromPlanned = await save(plannedFrom);
    check("the save lands", fromPlanned.status === 200, fromPlanned.text.slice(0, 300));
    const { data: versionPlanned } = await supabaseAdmin
      .from("nutrition_plans")
      .select("baseline_calories, goal_weight_kg, goal_deadline")
      .eq("client_id", C)
      .eq("effective_from", plannedFrom)
      .single();
    check(
      "the saved version is the previewed one, built for Build",
      versionPlanned?.baseline_calories === previewed.baselineCalories &&
        Number(versionPlanned?.goal_weight_kg) === 84.6 && versionPlanned?.goal_deadline === day(150),
      { versionPlanned, previewed: previewed.baselineCalories }
    );
    const settled = await outOfDate();
    check("nothing is out of date any more", settled.status === 200 && settled.data.outOfDate === null, settled);

    console.info("4. Ownership and input");
    const { data: foreign } = await supabaseAdmin
      .from("clients")
      .select("id")
      .neq("coach_id", coach.id)
      .limit(1)
      .single();
    if (!foreign) throw new Error("Setup: no client of another coach to try");
    const foreignDay = await send(session, "GET", `/api/clients/${foreign.id}/nutrition/goal?date=${today}`);
    const foreignRule = await send(session, "GET", `/api/clients/${foreign.id}/nutrition/goal/out-of-date`);
    check("another coach's client is 404 on both reads", foreignDay.status === 404 && foreignRule.status === 404, [foreignDay.status, foreignRule.status]);
    const malformed = await send(session, "GET", `${base}/goal?date=tomorrow`);
    check("a malformed day is 400", malformed.status === 400, malformed.status);
  } finally {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", C);
    const { error: deleteError } = await supabaseAdmin.from("clients").delete().eq("id", C);
    if (auditError || deleteError) console.error("Cleanup failed:", auditError?.message, deleteError?.message);
    else console.info("Cleanup: the throwaway client removed with its goals, plans and audit rows.");
  }
}

async function main(): Promise<void> {
  await partOne();
  await partTwo();
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
