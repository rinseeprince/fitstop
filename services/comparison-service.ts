import { getCheckInById, getPreviousCheckIn, getClientCheckIns, getFirstCheckIn } from "./check-in-service";
import { getClientById } from "./client-service";
import { supabaseAdmin } from "./supabase-admin";
import { prepareChartData } from "@/lib/check-in-utils";
import { calculateMetricChange, calculateDaysBetween, calculateGoalProgress } from "@/utils/comparison-utils";
import { computeGoalPace } from "@/lib/check-in/goal-pace";
import { getBodyMetricsHistory } from "./body-metrics-service";
import { getCurrentGoals } from "./client-goals-service";
import { getClientPhases } from "./client-phases-service";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { weightFromKg } from "@/utils/nutrition-helpers";
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

  // Fetch all check-ins for chart data (last 10), first check-in for starting values,
  // active nutrition plan for base weight and created date, goal_deadline from clients table,
  // earliest body_metrics for starting values, and current goals from client_goals
  const [{ checkIns }, firstCheckIn, { data: activePlan }, earliestMetrics, currentGoals, phases] = await Promise.all([
    getClientCheckIns(currentCheckIn.clientId, { limit: 10 }),
    getFirstCheckIn(currentCheckIn.clientId),
    supabaseAdmin
      .from("nutrition_plans")
      .select("base_weight_kg, created_at")
      .eq("client_id", currentCheckIn.clientId)
      .eq("status", "active")
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBodyMetricsHistory(currentCheckIn.clientId, { limit: 1, ascending: true }),
    getCurrentGoals(currentCheckIn.clientId),
    // Joins the existing fan-out rather than awaiting after it: latency stays
    // one round trip, not the sum of two (CONVENTIONS §2 perf #11).
    getClientPhases(currentCheckIn.clientId),
  ]);

  // Single-scope effective goal (Session 7.8): the live client goal. Weight AND
  // deadline come from ONE scope — fixing the cross-scope "Deadline unrealistic"
  // false alarm (the old code paired the client-scope goal weight with the active
  // nutrition plan's deadline). Displayed in the client's unit.
  const weightUnit = client.weightUnit ?? "lbs";
  // Client-local today: the pace window is on the client's calendar. The
  // client record is already in scope, so resolve their zone directly.
  const clientToday = getTodayDateStringInTimezone(client.timezone);
  const effectiveGoal = resolveEffectiveGoal({
    weightUnit,
    clientGoal: {
      goalWeight: currentGoals?.goalWeight ?? client.goalWeight ?? null,
      goalBodyFatPercentage:
        currentGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage ?? null,
      deadline: currentGoals?.goalDeadline ?? client.goalDeadline ?? null,
      startDate: currentGoals?.goalStartDate ?? null,
    },
    today: clientToday,
    phases,
    // Anchored on the period this check-in REPORTS ON, not on today (owner
    // decision): a check-in reviewed late must be graded against the block that
    // was running while the client lived it. `periodEnd` is optional on the
    // legacy token flow, so today is the fallback.
    date: currentCheckIn.periodEnd ?? clientToday,
  });

  // Effective goal in DISPLAY units so the displayed goal and the pace share scope.
  // Round to 1 decimal (display precision) to kill kg↔display float round-trip noise.
  const goalWeight =
    effectiveGoal.goalWeightKg != null
      ? Math.round(weightFromKg(effectiveGoal.goalWeightKg, weightUnit) * 10) / 10
      : undefined;
  const goalBodyFatPercentage = effectiveGoal.goalBodyFatPercentage ?? undefined;
  const earliestWeight = earliestMetrics[0]?.weight ?? client.startingWeight;
  const earliestBodyFat = earliestMetrics[0]?.bodyFatPercentage ?? client.startingBodyFatPercentage;

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

  // Calculate time between check-ins
  const timeBetweenCheckIns = previousCheckIn
    ? calculateDaysBetween(currentCheckIn.createdAt, previousCheckIn.createdAt)
    : undefined;

  // Build comparison data
  const comparison: CheckInComparison = {
    current: currentCheckIn,
    previous: previousCheckIn,
    client: {
      id: client.id,
      name: client.name,
      goalWeight,
      goalBodyFatPercentage,
      goalDeadline,
      currentWeight: client.currentWeight,
      currentBodyFatPercentage: client.currentBodyFatPercentage,
      weightUnit: client.weightUnit,
      unitPreference: client.unitPreference,
      nutritionPlanBaseWeightKg: activePlan?.base_weight_kg ?? undefined,
      nutritionPlanCreatedDate: activePlan?.created_at ?? undefined,
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
      waist: calculateMetricChange(
        currentCheckIn.waist,
        previousCheckIn?.waist
      ),
      hips: calculateMetricChange(
        currentCheckIn.hips,
        previousCheckIn?.hips
      ),
      chest: calculateMetricChange(
        currentCheckIn.chest,
        previousCheckIn?.chest
      ),
      arms: calculateMetricChange(
        currentCheckIn.arms,
        previousCheckIn?.arms
      ),
      thighs: calculateMetricChange(
        currentCheckIn.thighs,
        previousCheckIn?.thighs
      ),
      workoutsCompleted: calculateMetricChange(
        currentCheckIn.workoutsCompleted,
        previousCheckIn?.workoutsCompleted
      ),
      adherencePercentage: calculateMetricChange(
        currentCheckIn.adherencePercentage,
        previousCheckIn?.adherencePercentage
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

  // Calculate average weekly changes from historical data
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
      remaining: progress.remaining,
      percentComplete: progress.percentComplete,
      unit: currentCheckIn.weightUnit || "lbs",
      isOnTrack: progress.isOnTrack,
      avgWeeklyChange: avgWeeklyWeightChange,
      weeksToGoal: progress.weeksToGoal,
    };

    // Pace check: is the rate required to hit the goal safe? With a block
    // covering this check-in's period, the required rate is the one the coach
    // prescribed for that block rather than the deadline-derived average.
    //
    // Converted to DISPLAY units first: this whole path runs in the client's
    // unit (`progress.remaining` and `currentCheckIn.weight` are both display),
    // while a block stores kg. Passing the kg rate straight through would grade
    // an lbs client's 0.5 kg/wk block against an lbs ceiling — a 2.2x error.
    const prescribedRatePerWeek =
      effectiveGoal.phaseRateKgPerWeek != null
        ? weightFromKg(effectiveGoal.phaseRateKgPerWeek, weightUnit)
        : null;
    const pace =
      weeksRemaining !== null
        ? computeGoalPace({
            remainingKg: progress.remaining,
            weeksRemaining,
            currentWeightKg: currentCheckIn.weight,
            prescribedRatePerWeek,
          })
        : null;
    if (pace) {
      goalProgress.weight.paceStatus = pace.status;
      goalProgress.weight.requiredRate = pace.requiredRate;
      goalProgress.weight.safeCeiling = pace.safeCeiling;
    }

    // Calculate projected completion date
    if (avgWeeklyWeightChange && progress.weeksToGoal) {
      const projectedDate = new Date();
      projectedDate.setDate(
        projectedDate.getDate() + progress.weeksToGoal * 7
      );
      goalProgress.weight.projectedCompletionDate =
        projectedDate.toISOString();
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
      remaining: progress.remaining,
      percentComplete: progress.percentComplete,
      isOnTrack: progress.isOnTrack,
      avgChange: avgBodyFatChange,
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

  // Prepare chart data
  const chartData = prepareChartData(checkIns);

  return {
    comparison,
    goalProgress,
    chartData,
  };
};
