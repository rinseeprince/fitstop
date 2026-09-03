import { calculateGoalProgress } from "@/utils/comparison-utils";
import { computeGoalPace } from "@/lib/check-in/goal-pace";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { GoalPosition, GoalProgressRows } from "@/types/check-in";

/**
 * Where a client stands against each goal they have set — composed ONCE, here,
 * from a goal and the readings in force AT A DATE.
 *
 * The date is the caller's. The check-in review hands in the readings as of
 * the check-in's own day — its stamped row, else the newest reading before it
 * (`getReadingsAsOf`) — with the goal version in force then, so a review
 * describes where the client was at that time; a surface about today hands in
 * today's. A check-in object is never an input: a check-in is a report of
 * what the client typed that week, every field on it optional, so a
 * weightless one is ordinary, and a goal row built from it vanished for
 * exactly the client whose weight was in the log.
 * `lib/goals/goal-progress-ownership.test.ts` keeps the check-in out and keeps
 * the review's readings coming from the as-of read.
 *
 * A row exists for every goal that is set. Its `position` is null when no
 * reading exists as of the date: the goal is real, the verdict is not, and
 * the strip says so rather than reading the row's absence as "no goal".
 */
type ClientReadings = {
  currentWeight?: number;
  currentBodyFatPercentage?: number;
  startingWeight?: number;
  startingBodyFatPercentage?: number;
};

type GoalTrend = {
  /** kg per week over the recent readings; undefined below two of them. */
  avgWeeklyWeightChange?: number;
  /** Percentage points per reading over the recent readings. */
  avgBodyFatChange?: number;
};

type GoalProgressInput = {
  effectiveGoal: Pick<EffectiveGoal, "goalWeightKg" | "goalBodyFatPercentage" | "deadline">;
  /** The readings in force at the surface's date, and the baseline. */
  client: ClientReadings;
  trend: GoalTrend;
  /** Whole days from the surface's date to the deadline on the client's calendar; null without one. */
  daysRemaining: number | null;
  weeksRemaining: number | null;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function deriveGoalProgress({
  effectiveGoal,
  client,
  trend,
  daysRemaining,
  weeksRemaining,
}: GoalProgressInput): GoalProgressRows {
  const goalProgress: GoalProgressRows = {};

  if (effectiveGoal.goalWeightKg != null) {
    // Kilograms, like every other weight the comparison returns (migration
    // 141), rounded to 1 decimal for display precision; the render boundary
    // converts for the viewer.
    const goal = round1(effectiveGoal.goalWeightKg);
    goalProgress.weight = {
      goal,
      startingWeight: client.startingWeight,
      position:
        client.currentWeight == null
          ? null
          : positionOf({
              current: client.currentWeight,
              goal,
              start: client.startingWeight,
              avgChange: trend.avgWeeklyWeightChange,
              // Pace is a weight question: the safe ceiling is a fraction of
              // bodyweight, and only a deadline gives it a rate to judge.
              weeksRemaining,
            }),
    };
  }

  if (effectiveGoal.goalBodyFatPercentage != null) {
    const goal = effectiveGoal.goalBodyFatPercentage;
    goalProgress.bodyFat = {
      goal,
      startingBodyFat: client.startingBodyFatPercentage,
      position:
        client.currentBodyFatPercentage == null
          ? null
          : positionOf({
              current: client.currentBodyFatPercentage,
              goal,
              start: client.startingBodyFatPercentage,
              avgChange: trend.avgBodyFatChange,
              weeksRemaining: null,
            }),
    };
  }

  if (effectiveGoal.deadline && daysRemaining !== null) {
    goalProgress.deadline = {
      date: effectiveGoal.deadline,
      daysRemaining,
      isPastDeadline: daysRemaining < 0,
    };
  }

  return goalProgress;
}

function positionOf({
  current,
  goal,
  start,
  avgChange,
  weeksRemaining,
}: {
  current: number;
  goal: number;
  start?: number;
  avgChange?: number;
  weeksRemaining: number | null;
}): GoalPosition {
  const progress = calculateGoalProgress(current, goal, start, avgChange);
  const position: GoalPosition = {
    current,
    remaining: progress.remaining,
    percentComplete: progress.percentComplete,
    status: progress.status,
    isOnTrack: progress.isOnTrack,
  };

  // Is the rate REQUIRED to hit the goal by the deadline safe? Null for a met
  // or passed goal, and without a deadline there is no rate to require.
  const pace =
    weeksRemaining !== null
      ? computeGoalPace({
          remainingKg: progress.remaining,
          weeksRemaining,
          currentWeightKg: current,
          goalStatus: progress.status,
        })
      : null;
  if (pace) position.paceStatus = pace.status;

  return position;
}
