import { getCheckInById, getPreviousCheckIn, getClientCheckIns } from "./check-in-service";
import { getClientById } from "./client-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { calculateMetricChange, calculateDaysBetween } from "@/utils/comparison-utils";
import { getGoalAsOf } from "./client-goals-service";
import { getReadingsAsOf } from "./measurements-service";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { deriveGoalProgress } from "@/lib/goals/goal-progress";
import { getTodayDateStringInTimezone, getTodayInTimezone, differenceInDays } from "@/lib/date-helpers";
import type {
  CheckInComparison,
  GetCheckInComparisonResponse,
  GoalProgress,
} from "@/types/check-in";

/**
 * The comparison behind a check-in's review. Everything on it reflects where
 * the client was AT THAT TIME (owner decision 2026-09-03,
 * docs/MEASUREMENT-LOG-PLAN.md commit 8b): the goal strip judges the reading
 * as of the check-in's day against the goal version in force at its instant,
 * with days remaining counted from that day, a trend over the check-ins up to
 * it, and the drift note against the nutrition version covering that day. The
 * Overview and the Journey keep reading today.
 *
 * One clock: `at` is the check-in's instant and `day` its day on the client's
 * calendar — the conversion the check-in writer used for its readings'
 * `recorded_on`.
 */
export const getCheckInComparison = async (
  checkInId: string
): Promise<GetCheckInComparisonResponse> => {
  const currentCheckIn = await getCheckInById(checkInId);
  if (!currentCheckIn) {
    throw new Error("Check-in not found");
  }

  const client = await getClientById(currentCheckIn.clientId);
  if (!client) {
    throw new Error("Client not found");
  }

  const previousCheckIn = await getPreviousCheckIn(
    currentCheckIn.clientId,
    checkInId
  );

  const at = currentCheckIn.createdAt;
  const submitted = new Date(at);
  const day = getTodayDateStringInTimezone(client.timezone, submitted);

  // Four independent reads, one round trip: the ten check-ins up to this one
  // (the trend), the nutrition version covering its day (the drift note), the
  // goal version in force at its instant, and the readings as of its day.
  const [{ checkIns }, planThen, goalThen, readingsThen] = await Promise.all([
    getClientCheckIns(currentCheckIn.clientId, { limit: 10, upTo: at }),
    getNutritionPlanForDate(currentCheckIn.clientId, day).catch((err) => {
      // Degrade to "no plan" for the drift note rather than failing the whole
      // comparison read — but never silently.
      console.error("Comparison covering-plan lookup failed:", err);
      return null;
    }),
    getGoalAsOf(currentCheckIn.clientId, at),
    getReadingsAsOf(currentCheckIn.clientId, day, checkInId),
  ]);

  // The goal then. The review reads the versions alone — no `clients.*`
  // mirror leg, the client journey read's precedent — so a check-in older than
  // every version has no goal on its page: the client had none then. Weight
  // AND deadline come from ONE version, so the pace check cannot pair one
  // version's weight with another's deadline.
  const effectiveGoal = resolveEffectiveGoal({
    clientGoal: goalThen
      ? {
          goalWeight: goalThen.goalWeight ?? null,
          goalBodyFatPercentage: goalThen.goalBodyFatPercentage ?? null,
          deadline: goalThen.goalDeadline ?? null,
        }
      : null,
  });

  // Still the client's live goal, or one since replaced? The strip offers
  // "Set new goals" only for the live one.
  const goalIsCurrent = goalThen != null && goalThen.supersededAt == null;

  // The clock then: whole days from the check-in's day to the deadline, on the
  // client's calendar, so `computeGoalPace` judges the rate required FROM THEN.
  // "T00:00:00" parses local-midnight to match getTodayInTimezone (NOT
  // parseISODate, which is UTC midnight).
  const goalDeadline = effectiveGoal.deadline ?? undefined;
  const daysRemaining = goalDeadline
    ? differenceInDays(
        new Date(goalDeadline + "T00:00:00"),
        getTodayInTimezone(client.timezone, submitted)
      )
    : null;
  const weeksRemaining = daysRemaining !== null ? daysRemaining / 7 : null;

  const timeBetweenCheckIns = previousCheckIn
    ? calculateDaysBetween(currentCheckIn.createdAt, previousCheckIn.createdAt)
    : undefined;

  // The trend then. The ten check-ins up to and including this one feed one
  // thing: the average change per week, which is the TREND behind `isOnTrack`
  // — body fat's only trend signal, and weight's when there is no deadline to
  // pace against. Their readings are the measurement log's rows stamped with
  // each check-in (rule 6: what a check-in reported), folded in by
  // getClientCheckIns.
  const weightCheckIns = checkIns.filter((ci) => ci.weight);
  let avgWeeklyWeightChange: number | undefined;
  if (weightCheckIns.length >= 2) {
    const oldestWeight = weightCheckIns[weightCheckIns.length - 1].weight!;
    const newestWeight = weightCheckIns[0].weight!;
    const daysBetween = calculateDaysBetween(
      weightCheckIns[0].createdAt,
      weightCheckIns[weightCheckIns.length - 1].createdAt
    );
    if (daysBetween > 0) {
      const totalChange = newestWeight - oldestWeight;
      avgWeeklyWeightChange = Number(
        ((totalChange / daysBetween) * 7).toFixed(2)
      );
    }
  }

  // Calculate body fat average change
  const bodyFatCheckIns = checkIns.filter((ci) => ci.bodyFatPercentage);
  let avgBodyFatChange: number | undefined;
  if (bodyFatCheckIns.length >= 2) {
    const oldest = bodyFatCheckIns[bodyFatCheckIns.length - 1].bodyFatPercentage!;
    const newest = bodyFatCheckIns[0].bodyFatPercentage!;
    avgBodyFatChange = Number(
      ((newest - oldest) / bodyFatCheckIns.length).toFixed(2)
    );
  }

  // The start value: the client record's baseline — the reading as of their
  // start date, derived from the measurement log. The origin does not move
  // with the check-in. Without a baseline the reading then stands in, so a
  // client with no start date still has a direction to be judged in, from
  // then. Never the check-in object: it may carry no reading at all.
  const startingWeight = client.startingWeight ?? readingsThen.weight?.value;
  const startingBodyFat =
    client.startingBodyFatPercentage ?? readingsThen.bodyFat?.value;

  // Where they stood: the readings as of the check-in's day — its own stamped
  // row, else the newest before it — against the goal then, composed by the
  // one kernel. The check-in object is not an input here; the band's
  // `changes` below are where it speaks.
  const rows = deriveGoalProgress({
    effectiveGoal,
    client: {
      currentWeight: readingsThen.weight?.value,
      currentBodyFatPercentage: readingsThen.bodyFat?.value,
      startingWeight,
      startingBodyFatPercentage: startingBodyFat,
    },
    trend: { avgWeeklyWeightChange, avgBodyFatChange },
    daysRemaining,
    weeksRemaining,
  });
  const goalProgress: GoalProgress = { ...rows, goalIsCurrent };

  // Build comparison data
  const comparison: CheckInComparison = {
    previous: previousCheckIn,
    client: {
      id: client.id,
      name: client.name,
      // The kernel's rounded goals, so the band and the strip print one number.
      goalWeight: rows.weight?.goal,
      goalBodyFatPercentage: rows.bodyFat?.goal,
      goalDeadline,
      // The readings then, so the drift note compares like with like.
      currentWeight: readingsThen.weight?.value,
      currentBodyFatPercentage: readingsThen.bodyFat?.value,
      unitPreference: client.unitPreference,
      // The version covering the check-in's day (migration 144): its base
      // weight, and its effective_from — when the numbers the drift note
      // compares against took effect.
      nutritionPlanBaseWeightKg: planThen?.base_weight_kg ?? undefined,
      nutritionPlanEffectiveDate: planThen?.effective_from ?? undefined,
    },
    changes: {
      weight: calculateMetricChange(
        currentCheckIn.weight,
        previousCheckIn?.weight
      ),
      bodyFatPercentage: calculateMetricChange(
        currentCheckIn.bodyFatPercentage,
        previousCheckIn?.bodyFatPercentage
      ),
      mood: calculateMetricChange(
        currentCheckIn.mood,
        previousCheckIn?.mood
      ),
      energy: calculateMetricChange(
        currentCheckIn.energy,
        previousCheckIn?.energy
      ),
      sleep: calculateMetricChange(
        currentCheckIn.sleep,
        previousCheckIn?.sleep
      ),
      stress: calculateMetricChange(
        currentCheckIn.stress,
        previousCheckIn?.stress
      ),
      soreness: calculateMetricChange(
        currentCheckIn.soreness,
        previousCheckIn?.soreness
      ),
    },
    timeBetweenCheckIns,
  };

  return {
    comparison,
    goalProgress,
  };
};
