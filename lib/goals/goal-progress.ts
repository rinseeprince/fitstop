import { calculateGoalProgress } from "@/utils/comparison-utils";
import { computeGoalPace } from "@/lib/check-in/goal-pace";
import { goalDirection, type GoalType } from "@/lib/goals/goal-types";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { GoalPosition, GoalProgressRows } from "@/types/check-in";

/**
 * Where a client stands against each goal they have set — composed ONCE, here,
 * from a goal and the readings in force AT A DATE.
 *
 * The date is the caller's. The check-in review hands in the readings as of
 * the check-in's own day — its stamped row, else the newest reading before it
 * (`getReadingsAsOf`) — with the goal in force on that day, so a review
 * describes where the client was at that time; a surface about today hands in
 * today's. A check-in object is never an input: a check-in is a report of
 * what the client typed that week, every field on it optional, so a
 * weightless one is ordinary, and a goal row built from it vanished for
 * exactly the client whose weight was in the log.
 * `lib/goals/goal-progress-ownership.test.ts` keeps the check-in out and keeps
 * the review's readings coming from the as-of read.
 *
 * A goal's progress runs from the client's reading on the GOAL's start day, in
 * the direction its type sets (`goalDirection`): losing weight counts down and
 * building muscle up whatever side of the start the target sits on, and a type
 * that sets no direction for a metric counts towards the target from the start.
 * The client's baseline rides on the rows beside it, unjudged, for the
 * surfaces that count "since start".
 *
 * A row exists for every goal that is set. Its `position` is null when no
 * reading exists as of the date: the goal is real, the verdict is not, and
 * the strip says so rather than reading the row's absence as "no goal".
 */
type ClientReadings = {
  currentWeight?: number;
  currentBodyFatPercentage?: number;
  /** The baseline: the reading as of the client's start date. */
  startingWeight?: number;
  startingBodyFatPercentage?: number;
  /** The reading on the goal's start day, which progress runs from. */
  goalStartWeight?: number;
  goalStartBodyFatPercentage?: number;
};

type GoalTrend = {
  /** kg per week over the recent readings; undefined below two of them. */
  avgWeeklyWeightChange?: number;
  /** Percentage points per reading over the recent readings. */
  avgBodyFatChange?: number;
};

type GoalProgressInput = {
  effectiveGoal: Pick<EffectiveGoal, "goalWeightKg" | "goalBodyFatPercentage" | "deadline"> & {
    /** The goal's type — it sets the direction progress is judged in. */
    type: GoalType | null;
  };
  /** The readings in force at the surface's date, the goal's start and the baseline. */
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
    const start = client.goalStartWeight;
    goalProgress.weight = {
      goal,
      startingWeight: client.startingWeight,
      goalStartWeight: start,
      position:
        client.currentWeight == null
          ? null
          : positionOf({
              current: client.currentWeight,
              goal,
              start,
              direction: goalDirection(effectiveGoal.type, "weight", goal, start),
              avgChange: trend.avgWeeklyWeightChange,
              // Pace is a weight question: the safe ceiling is a fraction of
              // bodyweight, and only a deadline gives it a rate to judge.
              weeksRemaining,
            }),
    };
  }

  if (effectiveGoal.goalBodyFatPercentage != null) {
    const goal = effectiveGoal.goalBodyFatPercentage;
    const start = client.goalStartBodyFatPercentage;
    goalProgress.bodyFat = {
      goal,
      startingBodyFat: client.startingBodyFatPercentage,
      goalStartBodyFat: start,
      position:
        client.currentBodyFatPercentage == null
          ? null
          : positionOf({
              current: client.currentBodyFatPercentage,
              goal,
              start,
              direction: goalDirection(effectiveGoal.type, "bodyFat", goal, start),
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
  direction,
  avgChange,
  weeksRemaining,
}: {
  current: number;
  goal: number;
  /** The reading on the goal's start day. */
  start?: number;
  /** The way the target is approached — the goal type's, else from the start. */
  direction: -1 | 0 | 1;
  avgChange?: number;
  weeksRemaining: number | null;
}): GoalPosition {
  const progress = calculateGoalProgress(current, goal, start, avgChange, direction);
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
