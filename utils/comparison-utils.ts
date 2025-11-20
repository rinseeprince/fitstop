import type { MetricChange } from "@/types/check-in";

// Calculate metric change with trend
export function calculateMetricChange(
  current?: number,
  previous?: number
): MetricChange | undefined {
  if (current === undefined) return undefined;

  const metricChange: MetricChange = {
    current,
    previous,
  };

  if (previous !== undefined) {
    const change = Number((current - previous).toFixed(2));
    metricChange.change = change;

    if (previous !== 0) {
      metricChange.percentChange = Number(
        ((change / previous) * 100).toFixed(1)
      );
    }

    // Determine trend
    const threshold = 0.5;
    if (Math.abs(change) < threshold) {
      metricChange.trend = "stable";
    } else {
      metricChange.trend = change > 0 ? "up" : "down";
    }
  }

  return metricChange;
}

// Calculate days between check-ins
export function calculateDaysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d1.getTime() - d2.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Calculate goal progress
export function calculateGoalProgress(
  current: number,
  goal: number,
  startingValue?: number,
  avgChange?: number
): {
  remaining: number;
  percentComplete: number;
  isOnTrack: boolean;
  weeksToGoal?: number;
} {
  const remaining = Number((goal - current).toFixed(2));
  const totalChange = startingValue ? goal - startingValue : goal - current;
  const progressMade = startingValue ? current - startingValue : 0;

  let percentComplete = 0;
  if (totalChange !== 0) {
    percentComplete = Number(
      ((progressMade / totalChange) * 100).toFixed(1)
    );
  }

  // Calculate weeks to goal based on average change
  let weeksToGoal: number | undefined;
  let isOnTrack = true;

  if (avgChange && avgChange !== 0) {
    weeksToGoal = Math.abs(remaining / avgChange);
    // Consider on track if making any progress in the right direction
    const needToLose = goal < current;
    const isLosingWeight = avgChange < 0;
    const needToGain = goal > current;
    const isGainingWeight = avgChange > 0;

    isOnTrack = (needToLose && isLosingWeight) || (needToGain && isGainingWeight);
  }

  return {
    remaining,
    percentComplete: Math.min(100, Math.max(0, percentComplete)),
    isOnTrack,
    weeksToGoal,
  };
}
