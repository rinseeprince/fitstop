import type { DailyLog } from "@/types/daily-log";

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