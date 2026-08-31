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
/**
 * Where the client stands RELATIVE TO the goal. Position, not trend — the trend
 * is `isOnTrack`, and keeping them apart is the point: this module used to model
 * a goal as a scalar distance with no direction and no end, so passing the goal
 * read as distance still to travel. A client 5 kg beyond a weight-loss target
 * showed "100% Complete", "On track" and "Remaining 5kg" at once, and the pace
 * check quietly computed the rate needed to travel back up to it.
 */
export type GoalStatus = "approaching" | "achieved" | "overshot";

// A goal is "met" within this much of its target. Values are stored to 1-2
// decimals, so an exact equality test would almost never fire.
const GOAL_EPSILON = 0.05;

export function deriveGoalStatus(
  current: number,
  goal: number,
  startingValue?: number
): GoalStatus {
  if (Math.abs(goal - current) < GOAL_EPSILON) return "achieved";

  // The direction the client was asked to move. Without a start — or with a
  // start already at the goal — there is no direction to overshoot IN, so the
  // honest answer is that they are still approaching.
  const direction = startingValue != null ? goal - startingValue : 0;
  if (direction === 0) return "approaching";

  // Past the goal, travelling the way they were asked to: a loss goal whose
  // current value sits below it, or a gain goal whose current sits above.
  const overshot = direction < 0 ? current < goal : current > goal;
  return overshot ? "overshot" : "approaching";
}

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
  status: GoalStatus;
} {
  // Signed, deliberately. A renderer showing a magnitude ("5 kg to go") takes
  // Math.abs at the boundary — which is right while the goal is being
  // approached, and is why the sign lives here rather than being thrown away at
  // source: `status` is what tells a caller whether a magnitude means anything.
  const remaining = Number((goal - current).toFixed(2));
  const status = deriveGoalStatus(current, goal, startingValue);
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
    // Clamped for the progress BAR, which cannot render past its own track.
    // 100% is truthful once the goal is met; what was wrong was the "Remaining"
    // and pace figures printed beside it, not the percentage.
    percentComplete: Math.min(100, Math.max(0, percentComplete)),
    isOnTrack,
    weeksToGoal,
    status,
  };
}
