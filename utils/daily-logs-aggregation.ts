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
      avgSoreness: 0,
      sessionsCompleted: 0,
      totalPlannedSessions: 0,
      nutritionHitDays: 0,
      nutritionLoggedDays: 0,
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
  let sorenessSum = 0, sorenessCount = 0;

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
    if (log.soreness !== undefined && log.soreness !== null) {
      sorenessSum += log.soreness;
      sorenessCount++;
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
    avgSoreness: sorenessCount > 0 ? Math.round((sorenessSum / sorenessCount) * 10) / 10 : 0,
    sessionsCompleted,
    totalPlannedSessions,
    nutritionHitDays,
    nutritionLoggedDays: caloriesCount,
    totalLoggedDays: logs.length,
    avgCalories: caloriesCount > 0 ? Math.round(caloriesSum / caloriesCount) : 0,
    avgTargetCalories: targetCaloriesCount > 0 ? Math.round(targetCaloriesSum / targetCaloriesCount) : 0,
    totalSurplusDeficit: Math.round(totalSurplusDeficit),
    plannedActivitiesCompleted,
    totalPlannedActivities,
    unplannedActivitiesCount,
  };
}

export type MetricAverages = {
  mood: number;
  energy: number;
  sleep: number;
  stress: number;
  // Optional by design: soreness has NO fabricated fallback — a period with no
  // soreness logged yields undefined, never a default (check-in snapshot stays NULL).
  soreness?: number;
};

/**
 * Calculate metric averages from daily logs for check-in pre-fill
 */
export function calculateMetricAverages(dailyLogs: DailyLog[]): MetricAverages {
  // Soreness joins the filter so a soreness-only period counts as wellness data
  // (otherwise it would hit the fabricated-defaults branch and drop the real value).
  const validLogs = dailyLogs.filter(log =>
    log.mood !== undefined ||
    log.energy !== undefined ||
    log.sleep !== undefined ||
    log.stress !== undefined ||
    log.soreness !== undefined
  );

  if (validLogs.length === 0) {
    return { mood: 3, energy: 5, sleep: 5, stress: 5 };
  }

  const sums = validLogs.reduce((acc, log) => ({
    mood: acc.mood + (log.mood ?? 0),
    energy: acc.energy + (log.energy ?? 0),
    sleep: acc.sleep + (log.sleep ?? 0),
    stress: acc.stress + (log.stress ?? 0),
    soreness: acc.soreness + (log.soreness ?? 0),
    moodCount: acc.moodCount + (log.mood !== undefined ? 1 : 0),
    energyCount: acc.energyCount + (log.energy !== undefined ? 1 : 0),
    sleepCount: acc.sleepCount + (log.sleep !== undefined ? 1 : 0),
    stressCount: acc.stressCount + (log.stress !== undefined ? 1 : 0),
    sorenessCount: acc.sorenessCount + (log.soreness !== undefined ? 1 : 0),
  }), {
    mood: 0, energy: 0, sleep: 0, stress: 0, soreness: 0,
    moodCount: 0, energyCount: 0, sleepCount: 0, stressCount: 0, sorenessCount: 0
  });

  return {
    mood: sums.moodCount > 0 ? Math.round(sums.mood / sums.moodCount) : 3,
    energy: sums.energyCount > 0 ? Math.round(sums.energy / sums.energyCount) : 5,
    sleep: sums.sleepCount > 0 ? Math.round(sums.sleep / sums.sleepCount) : 5,
    stress: sums.stressCount > 0 ? Math.round(sums.stress / sums.stressCount) : 5,
    // Deliberate deviation from siblings: never-logged soreness stays undefined.
    soreness: sums.sorenessCount > 0 ? Math.round(sums.soreness / sums.sorenessCount) : undefined,
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