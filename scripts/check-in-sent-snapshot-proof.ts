/**
 * Request-level proof that a sent check-in is frozen (migration 195;
 * docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1, owner ruling 2026-09-22),
 * against the linked DEV database through a running `next dev`.
 *
 *   npx tsx scripts/check-in-sent-snapshot-proof.ts
 *
 * A throwaway client under the owner's coach, deleted at the end: an intake
 * weight, a goal, a nutrition version, a habit and a custom question. The
 * client sends a check-in through `submitCheckIn` (the POST's writer), then:
 *
 *   1  the copy saved in the INSERT equals the review's own computation run
 *      straight after the Send (`buildSentSnapshotAsShown`) — one kernel;
 *   2  the coach's review — the detail and the comparison, read as the coach
 *      over HTTP — and the AI review's prompt are recorded;
 *   3  the coach then corrects the check-in's weigh-in on the Journey, sets a
 *      new goal from today, saves a nutrition plan from today with the
 *      training surplus off, switches the habit off, rewords the question and
 *      moves the start date;
 *   4  the review, the comparison and the prompt read exactly as before — the
 *      one live answer, "is the judged goal still current", now says no;
 *   5  the database refuses a change to the saved copy and still takes the
 *      coach's reply.
 *
 * Every fixture number is distinct. The client's readings, goals, plans and
 * habits go with it (ON DELETE CASCADE); its check-in and question go first.
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { addGoal } from "@/services/client-goal-writes-service";
import { submitCheckIn } from "@/services/check-in-service";
import { buildSentSnapshotAsShown } from "@/services/check-in-sent-snapshot-fill";
import { getCheckInReviewInput } from "@/services/check-in-review-input-service";
import { buildCheckInReviewPrompt } from "@/utils/ai-prompt-builder";
import { GOAL_TYPE_SETTINGS } from "@/lib/goals/goal-types";
import { addDaysToDateString, getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { mintSession, send, type ProofSession } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.info(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

/**
 * Deep-equal by value, ignoring `updatedAt` (the row's own timestamp is not
 * the check-in) and key order (jsonb stores a copy's keys in its own order).
 */
function same(a: unknown, b: unknown): boolean {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key, inner]) => key !== "updatedAt" && inner !== undefined)
          .sort(([x], [y]) => (x < y ? -1 : 1))
          .map(([key, inner]) => [key, strip(inner)])
      );
    }
    return value;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

async function readReview(coach: ProofSession, checkInId: string) {
  const detail = await send(coach, "GET", `/api/check-in/${checkInId}`);
  const comparison = await send(coach, "GET", `/api/check-in/${checkInId}/comparison`);
  const input = await getCheckInReviewInput(checkInId);
  return {
    status: [detail.status, comparison.status],
    detail: detail.json as { checkIn: Record<string, unknown>; periodAdherence: unknown },
    comparison: comparison.json as { goalProgress: Record<string, unknown>; comparison: unknown },
    prompt: input ? buildCheckInReviewPrompt(input) : null,
  };
}

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);
  const coachSession = await mintSession(COACH_EMAIL, "coach");

  const zone = "Europe/London";
  const today = getTodayDateStringInTimezone(zone);
  const d = (offset: number) => addDaysToDateString(today, offset);
  const stamp = Date.now();

  const { data: created, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coach.id,
      name: "Sent snapshot proof",
      email: `sent-snapshot-proof-${stamp}@fixture.local`,
      active: true,
      user_id: null,
      start_date: d(-21),
      timezone: zone,
      onboarding_status: "active",
      height: 172,
      gender: "male",
      date_of_birth: "1989-06-17",
      next_check_in_due: today,
      check_in_frequency: "weekly",
    } as never)
    .select("id")
    .single();
  if (clientError || !created) throw new Error(`Client insert failed: ${clientError?.message}`);
  const C = created.id;
  let questionId: string | null = null;

  try {
    console.info("Setup");
    await appendMeasurements({ clientId: C, source: "intake", recordedOn: d(-21), values: { weight: 91.7, bodyFat: 24.6 } });
    await addGoal({
      clientId: C,
      today: d(-11),
      startsOn: d(-11),
      source: "coach",
      setBy: coach.id,
      type: "lose_weight",
      name: GOAL_TYPE_SETTINGS.lose_weight.name,
      targetWeight: 81.3,
      targetBodyFatPercentage: null,
      description: null,
      deadline: d(47),
    });
    const { error: planError } = await supabaseAdmin.from("nutrition_plans").insert({
      client_id: C,
      coach_id: coach.id,
      name: "Sent snapshot proof plan",
      status: "active",
      effective_from: d(-11),
      effective_until: d(33),
      work_activity_level: "moderately_active",
      training_volume_hours: "3-5",
      protein_target_g_per_kg: 2.1,
      diet_type: "balanced",
      baseline_calories: 2140,
      protein_target_g: 176,
      carb_target_g: 214,
      fat_target_g: 67,
      base_weight_kg: 89.9,
      bmr: 1830,
      tdee: 2610,
    } as never);
    if (planError) throw new Error(`Plan insert failed: ${planError.message}`);
    const { data: habit, error: habitError } = await supabaseAdmin
      .from("daily_habits")
      .insert({ client_id: C, coach_id: coach.id, name: "Ten thousand steps", is_active: true, effective_date: d(-11) } as never)
      .select("id")
      .single();
    if (habitError || !habit) throw new Error(`Habit insert failed: ${habitError?.message}`);
    const { data: question, error: questionError } = await supabaseAdmin
      .from("check_in_questions")
      .insert({ coach_id: coach.id, prompt: "What went well this week?" } as never)
      .select("id")
      .single();
    if (questionError || !question) throw new Error(`Question insert failed: ${questionError?.message}`);
    questionId = question.id;

    console.info("1. The Send saves the copy in its INSERT, equal to the review's computation");
    const checkInId = await submitCheckIn(C, {
      weight: 86.4,
      bodyFatPercentage: 21.8,
      notes: "Sent snapshot proof",
      customAnswers: [{ questionId: question.id, answer: "Hit every session" }],
    } as never);
    const { data: row, error: rowError } = await supabaseAdmin.from("check_ins").select("*").eq("id", checkInId).single();
    if (rowError || !row) throw new Error(`Check-in read failed: ${rowError?.message}`);
    check("the saved copy is there from the INSERT", row.sent_snapshot != null);
    const recomputed = await buildSentSnapshotAsShown({ ...row, sent_snapshot: null });
    check("the saved copy equals the review's own computation run straight after the Send", same(row.sent_snapshot, recomputed), { saved: row.sent_snapshot, recomputed });

    console.info("2. The review as sent");
    const before = await readReview(coachSession, checkInId);
    check("detail and comparison → 200", before.status.every((status) => status === 200), before.status);
    check("the check-in reports the weight the client sent (86.4)", before.detail.checkIn.weight === 86.4, before.detail.checkIn.weight);
    check("the saved copy never reaches the browser", !("sentSnapshot" in before.detail.checkIn));
    check("the goal judged is the client's goal today", before.comparison.goalProgress.goalIsCurrent === true);

    console.info("3. The coach changes everything a sent check-in used to follow");
    const { data: stampedWeight } = await supabaseAdmin
      .from("client_measurements")
      .select("id")
      .eq("source_id", checkInId)
      .eq("metric_key", "weight")
      .single();
    const corrected = await send(coachSession, "PATCH", `/api/clients/${C}/measurements/${stampedWeight?.id}`, { value: 84.9 });
    check("the weigh-in is corrected in the log (84.9)", corrected.status === 200, corrected.text.slice(0, 200));
    await addGoal({
      clientId: C,
      today,
      startsOn: today,
      source: "coach",
      setBy: coach.id,
      type: "lose_weight",
      name: GOAL_TYPE_SETTINGS.lose_weight.name,
      targetWeight: 77.6,
      targetBodyFatPercentage: null,
      description: null,
      deadline: d(29),
    });
    // The training surplus switched off the only way a coach can (migration
    // 196): a plan saved from today with it off, through the save function.
    const { error: surplusError } = await supabaseAdmin.rpc("create_nutrition_plan_atomic", {
      p_client_id: C,
      p_coach_id: coach.id,
      p_work_activity_level: "moderately_active",
      p_training_volume_hours: "3-5",
      p_protein_target_g_per_kg: 2.1,
      p_diet_type: "balanced",
      p_goal_weight_kg: null,
      p_goal_deadline: null,
      p_baseline_calories: 2140,
      p_protein_target_g: 176,
      p_carb_target_g: 214,
      p_fat_target_g: 67,
      p_base_weight_kg: 89.9,
      p_bmr: 1830,
      p_tdee: 2610,
      p_custom_macros_enabled: false,
      p_custom_calories: null,
      p_custom_protein_g: null,
      p_custom_carb_g: null,
      p_custom_fat_g: null,
      p_regeneration_reason: "regenerated",
      p_daily_targets: [],
      p_include_activity_burn: false,
      p_surplus_as_carbs: false,
      p_effective_until: d(33),
      p_effective_from: today,
      p_today: today,
    } as never);
    check("a plan saved from today with the surplus off", !surplusError, surplusError?.message);
    await supabaseAdmin.from("daily_habits").update({ is_active: false } as never).eq("id", habit.id);
    await supabaseAdmin.from("check_in_questions").update({ prompt: "What was your biggest win?" } as never).eq("id", question.id);
    await supabaseAdmin.from("clients").update({ start_date: d(-16) } as never).eq("id", C);

    console.info("4. The sent check-in reads exactly as before");
    const after = await readReview(coachSession, checkInId);
    check("detail and comparison → 200", after.status.every((status) => status === 200), after.status);
    check("the check-in still reports 86.4 — the correction changed the log, not the check-in", after.detail.checkIn.weight === 86.4, after.detail.checkIn.weight);
    check("the review's detail is unchanged (readings, food, habits, answers and their wording)", same(before.detail, after.detail), { before: before.detail, after: after.detail });
    const { goalIsCurrent: currentBefore, ...goalBefore } = before.comparison.goalProgress;
    const { goalIsCurrent: currentAfter, ...goalAfter } = after.comparison.goalProgress;
    check("the goal section is unchanged", same(goalBefore, goalAfter), { goalBefore, goalAfter });
    check("the comparison's readings, deadline and drift note are unchanged", same(before.comparison.comparison, after.comparison.comparison));
    check("the one live answer moved: the judged goal is no longer the current one", currentBefore === true && currentAfter === false, { currentBefore, currentAfter });
    check("the AI review's prompt is unchanged", before.prompt !== null && before.prompt === after.prompt);

    console.info("5. The database keeps the copy");
    const { error: frozen } = await supabaseAdmin.from("check_ins").update({ sent_snapshot: { version: 1 } } as never).eq("id", checkInId);
    check("a change to the saved copy is refused", frozen?.message.includes("sent_snapshot_frozen") === true, frozen?.message);
    const { error: reply } = await supabaseAdmin.from("check_ins").update({ coach_response: "Proof reply" } as never).eq("id", checkInId);
    check("the coach's reply still saves", reply === null, reply?.message);
  } finally {
    await supabaseAdmin.from("check_ins").delete().eq("client_id", C);
    if (questionId) await supabaseAdmin.from("check_in_questions").delete().eq("id", questionId);
    const { error: cleanup } = await supabaseAdmin.from("clients").delete().eq("id", C);
    if (cleanup) console.error(`Cleanup failed: ${cleanup.message}`);
  }

  console.info(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
