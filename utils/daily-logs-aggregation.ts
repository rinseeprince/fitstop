import type { DailyLog } from "@/types/daily-log";

/**
 * Aggregates daily logs data for check-in summary
 */
export function aggregateDailyLogs(logs: DailyLog[]) {
  if (!logs || logs.length === 0) {
    return {
      avgMood: 0,
      avgEnergy: 0,
      avgSleep: 0,
      avgStress: 0,
      sessionsCompleted: 0,
      totalPlannedSessions: 0,
      nutritionHitDays: 0,
      totalLoggedDays: 0,
      avgCalories: 0,
      avgTargetCalories: 0,
      totalSurplusDeficit: 0,
      plannedActivitiesCompleted: 0,
      totalPlannedActivities: 0,
      unplannedActivitiesCount: 0,
    };
  }

  // Count wellness metrics
  let moodSum = 0, moodCount = 0;
  let energySum = 0, energyCount = 0;
  let sleepSum = 0, sleepCount = 0;
  let stressSum = 0, stressCount = 0;

  // Count training metrics
  let sessionsCompleted = 0;
  let totalPlannedSessions = 0;
  let plannedActivitiesCompleted = 0;
  let totalPlannedActivities = 0;
  let unplannedActivitiesCount = 0;

  // Count nutrition metrics
  let nutritionHitDays = 0;
  let caloriesSum = 0, caloriesCount = 0;
  let targetCaloriesSum = 0, targetCaloriesCount = 0;
  let totalSurplusDeficit = 0;

  for (const log of logs) {
    // Aggregate wellness metrics
    if (log.mood !== undefined && log.mood !== null) {
      moodSum += log.mood;
      moodCount++;
    }
    if (log.energy !== undefined && log.energy !== null) {
      energySum += log.energy;
      energyCount++;
    }
    if (log.sleep !== undefined && log.sleep !== null) {
      sleepSum += log.sleep;
      sleepCount++;
    }
    if (log.stress !== undefined && log.stress !== null) {
      stressSum += log.stress;
      stressCount++;
    }

    // Count training sessions
    if (log.trained === true) {
      sessionsCompleted++;
    }
    // Count planned sessions (any day with a training session ID is a planned training day)
    if (log.trainingData?.trainingSessionId) {
      totalPlannedSessions++;
    }

    // Count planned activity completions
    if (log.trainingData?.activityStatuses) {
      for (const [_, status] of Object.entries(log.trainingData.activityStatuses)) {
        totalPlannedActivities++;
        // CRITICAL: Read the .completed field, not the object itself
        if (status.completed === true) {
          plannedActivitiesCompleted++;
        }
      }
    }

    // Count unplanned activities
    if (log.trainingData?.unplannedActivities) {
      unplannedActivitiesCount += log.trainingData.unplannedActivities.length;
    }

    // Count nutrition adherence
    if (log.nutritionAdherence === "hit") {
      nutritionHitDays++;
    }

    // Aggregate nutrition metrics
    if (log.caloriesConsumed !== undefined && log.caloriesConsumed !== null) {
      caloriesSum += log.caloriesConsumed;
      caloriesCount++;
    }
    if (log.targetCalories !== undefined && log.targetCalories !== null) {
      targetCaloriesSum += log.targetCalories;
      targetCaloriesCount++;
    }
    if (log.calorieSurplusDeficit !== undefined && log.calorieSurplusDeficit !== null) {
      totalSurplusDeficit += log.calorieSurplusDeficit;
    }
  }

  return {
    avgMood: moodCount > 0 ? Math.round((moodSum / moodCount) * 10) / 10 : 0,
    avgEnergy: energyCount > 0 ? Math.round((energySum / energyCount) * 10) / 10 : 0,
    avgSleep: sleepCount > 0 ? Math.round((sleepSum / sleepCount) * 10) / 10 : 0,
    avgStress: stressCount > 0 ? Math.round((stressSum / stressCount) * 10) / 10 : 0,
    sessionsCompleted,
    totalPlannedSessions,
    nutritionHitDays,
    totalLoggedDays: logs.length,
    avgCalories: caloriesCount > 0 ? Math.round(caloriesSum / caloriesCount) : 0,
    avgTargetCalories: targetCaloriesCount > 0 ? Math.round(targetCaloriesSum / targetCaloriesCount) : 0,
    totalSurplusDeficit: Math.round(totalSurplusDeficit),
    plannedActivitiesCompleted,
    totalPlannedActivities,
    unplannedActivitiesCount,
  };
}

/**
 * Sanitizes reps value - returns undefined for invalid values
 */
export function sanitiseReps(value: any): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = typeof value === 'string' ? parseInt(value, 10) : Math.floor(value);
  
  if (isNaN(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}