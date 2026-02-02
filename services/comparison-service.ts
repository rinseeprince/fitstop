import { getCheckInById, getPreviousCheckIn, getClientCheckIns, getFirstCheckIn } from "./check-in-service";
import { getClientById } from "./client-service";
import { prepareChartData } from "@/lib/check-in-utils";
import { calculateMetricChange, calculateDaysBetween, calculateGoalProgress } from "@/utils/comparison-utils";
import type {
  CheckInComparison,
  GoalProgress,
  GetCheckInComparisonResponse,
  CheckIn,
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

  // Fetch all check-ins for chart data (last 10) and first check-in for starting values
  const [{ checkIns }, firstCheckIn] = await Promise.all([
    getClientCheckIns(currentCheckIn.clientId, { limit: 10 }),
    getFirstCheckIn(currentCheckIn.clientId),
  ]);

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
      goalWeight: client.goalWeight,
      goalBodyFatPercentage: client.goalBodyFatPercentage,
      goalDeadline: client.goalDeadline,
      currentWeight: client.currentWeight,
      currentBodyFatPercentage: client.currentBodyFatPercentage,
      weightUnit: client.weightUnit,
      unitPreference: client.unitPreference,
      nutritionPlanBaseWeightKg: client.nutritionPlanBaseWeightKg,
      nutritionPlanCreatedDate: client.nutritionPlanCreatedDate,
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
  if (currentCheckIn.weight && client.goalWeight) {
    // Priority: 1) client's starting weight, 2) first check-in, 3) oldest in recent set, 4) current
    const startingWeight = client.startingWeight
      ?? firstCheckIn?.weight
      ?? (weightCheckIns.length > 0 ? weightCheckIns[weightCheckIns.length - 1].weight : undefined)
      ?? currentCheckIn.weight;

    const progress = calculateGoalProgress(
      currentCheckIn.weight,
      client.goalWeight,
      startingWeight,
      avgWeeklyWeightChange
    );

    goalProgress.weight = {
      current: currentCheckIn.weight,
      goal: client.goalWeight,
      startingWeight,
      remaining: progress.remaining,
      percentComplete: progress.percentComplete,
      unit: currentCheckIn.weightUnit || "lbs",
      isOnTrack: progress.isOnTrack,
      avgWeeklyChange: avgWeeklyWeightChange,
      weeksToGoal: progress.weeksToGoal,
    };

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
    client.goalBodyFatPercentage !== undefined
  ) {
    // Priority: 1) client's starting body fat, 2) first check-in, 3) oldest in recent set, 4) current
    const startingBodyFat = client.startingBodyFatPercentage
      ?? firstCheckIn?.bodyFatPercentage
      ?? (bodyFatCheckIns.length > 0 ? bodyFatCheckIns[bodyFatCheckIns.length - 1].bodyFatPercentage : undefined)
      ?? currentCheckIn.bodyFatPercentage;

    const progress = calculateGoalProgress(
      currentCheckIn.bodyFatPercentage,
      client.goalBodyFatPercentage,
      startingBodyFat,
      avgBodyFatChange
    );

    goalProgress.bodyFat = {
      current: currentCheckIn.bodyFatPercentage,
      goal: client.goalBodyFatPercentage,
      startingBodyFat,
      remaining: progress.remaining,
      percentComplete: progress.percentComplete,
      isOnTrack: progress.isOnTrack,
      avgChange: avgBodyFatChange,
    };
  }

  // Deadline progress
  if (client.goalDeadline) {
    const deadline = new Date(client.goalDeadline);
    const now = new Date();
    const daysRemaining = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    goalProgress.deadline = {
      date: client.goalDeadline,
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
