import { getCheckInById, getPreviousCheckIn, getClientCheckIns, getFirstCheckIn } from "./check-in-service";
import { getClientById } from "./client-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { calculateMetricChange, calculateDaysBetween, calculateGoalProgress } from "@/utils/comparison-utils";
import { computeGoalPace } from "@/lib/check-in/goal-pace";
import { getBodyMetricsHistory } from "./body-metrics-service";
import { getCurrentGoals } from "./client-goals-service";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
} from "@/lib/goals/resolve-effective-goal";
import { getTodayDateStringInTimezone, getTodayInTimezone, differenceInDays } from "@/lib/date-helpers";
import type {
  CheckInComparison,
  GoalProgress,
  GetCheckInComparisonResponse,
} from "@/types/check-in";

export const getCheckInComparison = async (
  checkInId: string
): Promise<GetCheckInComparisonResponse> => {
  // Fetch current check-in
  const currentCheckIn = await getCheckInById(checkInId);
  if (!currentCheckIn) {
    throw new Error("Check-in not found");
  }

  // Fetch client info
  const client = await getClientById(currentCheckIn.clientId);
  if (!client) {
    throw new Error("Client not found");
  }

  // Fetch previous check-in
  const previousCheckIn = await getPreviousCheckIn(
    currentCheckIn.clientId,
    checkInId
  );

  // Fetch all check-ins for chart data (last 10), first check-in for starting
  // values, the nutrition version COVERING the client's today (migration 144 —
  // the drift banner must compare against the era actually governing them, and
  // date its "since" from when those numbers took effect, not from when the
  // first-ever plan row was born), earliest body_metrics for starting values,
  // and current goals from client_goals.
  const clientLocalToday = getTodayDateStringInTimezone(client.timezone);
  const [{ checkIns }, firstCheckIn, activePlan, earliestMetrics, currentGoals] = await Promise.all([
    getClientCheckIns(currentCheckIn.clientId, { limit: 10 }),
    getFirstCheckIn(currentCheckIn.clientId),
    getNutritionPlanForDate(currentCheckIn.clientId, clientLocalToday).catch((err) => {
      // Degrade to "no plan" for the banner rather than failing the whole
      // comparison read — but never silently.
      console.error("Comparison covering-plan lookup failed:", err);
      return null;
    }),
    getBodyMetricsHistory(currentCheckIn.clientId, { limit: 1, ascending: true }),
    getCurrentGoals(currentCheckIn.clientId),
  ]);

  // Single-scope effective goal (Session 7.8): the live client goal. Weight AND
  // deadline come from ONE scope — fixing the cross-scope "Deadline unrealistic"
  // false alarm (the old code paired the client-scope goal weight with the active
  // nutrition plan's deadline).
  const effectiveGoal = resolveEffectiveGoal({
    clientGoal: toClientGoalInput(currentGoals, client),
    // Client-local today: the pace window is on the client's calendar. The
    // client record is already in scope, so resolve their zone directly.
    today: getTodayDateStringInTimezone(client.timezone),
  });

  // Kilograms, like every other weight this service returns (migration 141), so
  // the goal and the pace still share scope. Rounded to 1 decimal for display
  // precision. Phase 3 converts to the viewer's unit at the render boundary.
  const goalWeight =
    effectiveGoal.goalWeightKg != null
      ? Math.round(effectiveGoal.goalWeightKg * 10) / 10
      : undefined;
  const goalBodyFatPercentage = effectiveGoal.goalBodyFatPercentage ?? undefined;
  // The COACH'S recorded start wins over the derived one. This preference used
  // to run the other way — earliest `body_metrics` first, column as fallback —
  // which was right while `starting_weight` was write-once: preferring a real
  // event over a denormalized copy. It became "ignore the coach" the moment the
  // column turned editable, because `body_metrics` is immutable by design, so a
  // corrected start weight would show on the Overview card and nowhere else.
  //
  // Behaviour-identical for every client who has not been corrected: creation
  // writes ONE typed measurement into both the column and the first event, and
  // the intake sync does the same, so the two agree by construction.
  const earliestWeight = client.startingWeight ?? earliestMetrics[0]?.weight;
  const earliestBodyFat =
    client.startingBodyFatPercentage ?? earliestMetrics[0]?.bodyFatPercentage;

  // Goal deadline, used by both the weight pace check and the deadline card —
  // from the SAME scope as goalWeight above (no cross-scope mismatch).
  const goalDeadline = effectiveGoal.deadline ?? undefined;
  // Whole-day difference anchored to the client's local midnight (the pace window
  // is on the client's calendar), not Date.now() ms-math that reads -1 across a
  // UTC day boundary while the client still has today — mirrors getDaysUntilOrPastDue.
  // "T00:00:00" parses local-midnight to match getTodayInTimezone (NOT parseISODate,
  // which is UTC midnight).
  const daysRemaining = goalDeadline
    ? differenceInDays(
        new Date(goalDeadline + "T00:00:00"),
        getTodayInTimezone(client.timezone)
      )
    : null;
  const weeksRemaining = daysRemaining !== null ? daysRemaining / 7 : null;

  const timeBetweenCheckIns = previousCheckIn
    ? calculateDaysBetween(currentCheckIn.createdAt, previousCheckIn.createdAt)
    : undefined;

  // Build comparison data
  const comparison: CheckInComparison = {
    previous: previousCheckIn,
    client: {
      id: client.id,
      name: client.name,
      goalWeight,
      goalBodyFatPercentage,
      goalDeadline,
      currentWeight: client.currentWeight,
      currentBodyFatPercentage: client.currentBodyFatPercentage,
      unitPreference: client.unitPreference,
      nutritionPlanBaseWeightKg: activePlan?.base_weight_kg ?? undefined,
      // The covering version's effective_from — when the numbers the banner
      // compares against actually took effect (renamed from
      // nutritionPlanCreatedDate, which under in-place editing had drifted to
      // meaning "when the first-ever plan row was born").
      nutritionPlanEffectiveDate: activePlan?.effective_from ?? undefined,
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

  // The recent set (ten check-ins) feeds two things and nothing else: the
  // average change per week, which is the TREND behind `isOnTrack` — body fat's
  // only trend signal, and weight's when there is no deadline to pace against —
  // and the third-priority starting-value fallback below.
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

  // Build goal progress
  const goalProgress: GoalProgress = {};

  // Weight goal progress
  if (currentCheckIn.weight && goalWeight) {
    // Priority: 1) earliest body_metrics / client starting weight, 2) first check-in, 3) oldest in recent set, 4) current
    const startingWeight = earliestWeight
      ?? firstCheckIn?.weight
      ?? (weightCheckIns.length > 0 ? weightCheckIns[weightCheckIns.length - 1].weight : undefined)
      ?? currentCheckIn.weight;

    const progress = calculateGoalProgress(
      currentCheckIn.weight,
      goalWeight,
      startingWeight,
      avgWeeklyWeightChange
    );

    goalProgress.weight = {
      current: currentCheckIn.weight,
      goal: goalWeight,
      startingWeight,
      status: progress.status,
      remaining: progress.remaining,
      percentComplete: progress.percentComplete,
      isOnTrack: progress.isOnTrack,
    };

    // Pace check: is the rate required to hit the goal by the deadline safe?
    const pace =
      weeksRemaining !== null
        ? computeGoalPace({
            remainingKg: progress.remaining,
            weeksRemaining,
            currentWeightKg: currentCheckIn.weight,
            goalStatus: progress.status,
          })
        : null;
    if (pace) {
      goalProgress.weight.paceStatus = pace.status;
    }
  }

  // Body fat goal progress
  if (
    currentCheckIn.bodyFatPercentage !== undefined &&
    goalBodyFatPercentage !== undefined
  ) {
    // Priority: 1) earliest body_metrics / client starting body fat, 2) first check-in, 3) oldest in recent set, 4) current
    const startingBodyFat = earliestBodyFat
      ?? firstCheckIn?.bodyFatPercentage
      ?? (bodyFatCheckIns.length > 0 ? bodyFatCheckIns[bodyFatCheckIns.length - 1].bodyFatPercentage : undefined)
      ?? currentCheckIn.bodyFatPercentage;

    const progress = calculateGoalProgress(
      currentCheckIn.bodyFatPercentage,
      goalBodyFatPercentage,
      startingBodyFat,
      avgBodyFatChange
    );

    goalProgress.bodyFat = {
      current: currentCheckIn.bodyFatPercentage,
      goal: goalBodyFatPercentage,
      startingBodyFat,
      status: progress.status,
      remaining: progress.remaining,
      percentComplete: progress.percentComplete,
      isOnTrack: progress.isOnTrack,
    };
  }

  // Deadline progress (reuses the hoisted goalDeadline / daysRemaining).
  if (goalDeadline && daysRemaining !== null) {
    goalProgress.deadline = {
      date: goalDeadline,
      daysRemaining,
      isPastDeadline: daysRemaining < 0,
    };
  }


  return {
    comparison,
    goalProgress,
  };
};
