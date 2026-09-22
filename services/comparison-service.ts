import { getCheckInById, getPreviousCheckIn, getClientCheckIns } from "./check-in-service";
import { getClientById } from "./client-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { calculateMetricChange, calculateDaysBetween } from "@/utils/comparison-utils";
import { listClientGoals } from "./client-goals-service";
import { getReadingsAsOf, getReadingsOnDay } from "./measurements-service";
import { getClientTodayString } from "./today-service";
import { goalAsOf, goalOnDay } from "@/lib/goals/goal-timeline";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { deriveGoalProgress } from "@/lib/goals/goal-progress";
import { getTodayDateStringInTimezone, getTodayInTimezone, differenceInDays } from "@/lib/date-helpers";
import type {
  CheckIn,
  CheckInComparison,
  Client,
  GetCheckInComparisonResponse,
  GoalProgress,
} from "@/types/check-in";

/**
 * The comparison behind a check-in's review. Everything on it reflects where
 * the client was AT THAT TIME (owner decision 2026-09-03,
 * docs/MEASUREMENT-LOG-PLAN.md commit 8b): the goal strip judges the reading
 * as of the check-in's day against the goal in force on that day, with that
 * day's deadline and days remaining counted from it, its progress measured
 * from the client's reading on the goal's own start day, a trend over the
 * check-ins up to it, and the drift note against the nutrition version
 * covering that day. The Overview and the Journey keep reading today.
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

  return buildCheckInComparison(currentCheckIn, client);
};

/**
 * The same comparison for a check-in and its client already in hand — the AI
 * review's input builder holds both and reads nothing twice.
 */
export const buildCheckInComparison = async (
  currentCheckIn: CheckIn,
  client: Client
): Promise<GetCheckInComparisonResponse> => {
  const checkInId = currentCheckIn.id;
  const previousCheckIn = await getPreviousCheckIn(
    currentCheckIn.clientId,
    checkInId
  );

  const at = currentCheckIn.createdAt;
  const submitted = new Date(at);
  const day = getTodayDateStringInTimezone(client.timezone, submitted);

  // Five independent reads, one round trip: the ten check-ins up to this one
  // (the trend), the nutrition version covering its day (the drift note), the
  // client's goals and their today (which goal was in force then, and whether
  // it still is), and the readings as of its day.
  const [{ checkIns }, planThen, goals, today, readingsThen] = await Promise.all([
    getClientCheckIns(currentCheckIn.clientId, { limit: 10, upTo: at }),
    getNutritionPlanForDate(currentCheckIn.clientId, day).catch((err) => {
      // Degrade to "no plan" for the drift note rather than failing the whole
      // comparison read — but never silently.
      console.error("Comparison covering-plan lookup failed:", err);
      return null;
    }),
    listClientGoals(currentCheckIn.clientId),
    getClientTodayString(currentCheckIn.clientId),
    getReadingsAsOf(currentCheckIn.clientId, day, checkInId),
  ]);

  // The goal then: the one in force on the check-in's day, with that day's
  // deadline. A check-in older than every goal has none on its page — the
  // client had none then. Weight AND deadline come from ONE goal on ONE day, so
  // the pace check cannot pair one goal's weight with another's deadline.
  const judgedGoal = goalOnDay(goals, day);
  const goalThen = judgedGoal ? goalAsOf(judgedGoal, day) : null;
  const effectiveGoal = resolveEffectiveGoal(goalThen);

  // Still the goal in force on the client's today, or one since replaced? The
  // strip offers "Set new goals" only for the goal in force.
  const goalIsCurrent = judgedGoal != null && judgedGoal.id === goalOnDay(goals, today)?.id;

  // Where the goal's progress runs from: the client's readings on its start day.
  const goalStartReadings = judgedGoal
    ? await getReadingsOnDay(currentCheckIn.clientId, judgedGoal.startsOn)
    : {};

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

  // The client's baseline — the reading as of their start date, derived from
  // the measurement log — which the rows carry for the KPI ribbon and the
  // prompt's weight line, both counting "since start". Without a baseline the
  // reading then stands in. Never the check-in object: it may carry no reading
  // at all. The goal's own progress does not run from here but from its start
  // day's readings, in the direction its type sets.
  const startingWeight = client.startingWeight ?? readingsThen.weight?.value;
  const startingBodyFat =
    client.startingBodyFatPercentage ?? readingsThen.bodyFat?.value;

  // Where they stood: the readings as of the check-in's day — its own stamped
  // row, else the newest before it — against the goal then, from the goal's
  // start, composed by the one kernel. The check-in object is not an input
  // here; the band's `changes` below are where it speaks.
  const rows = deriveGoalProgress({
    effectiveGoal: { ...effectiveGoal, type: goalThen?.type ?? null },
    client: {
      currentWeight: readingsThen.weight?.value,
      currentBodyFatPercentage: readingsThen.bodyFat?.value,
      startingWeight,
      startingBodyFatPercentage: startingBodyFat,
      goalStartWeight: goalStartReadings.weight?.value,
      goalStartBodyFatPercentage: goalStartReadings.bodyFat?.value,
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
