import { deriveGoalProgress } from "@/lib/goals/goal-progress";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { differenceInDays, getTodayInTimezone } from "@/lib/date-helpers";
import { calculateDaysBetween } from "@/utils/comparison-utils";
import type { GoalOnDay } from "@/types/client-goals";
import type { SentSnapshot } from "./sent-snapshot";

/**
 * The goal section of a sent check-in, composed once — when the client sends
 * it, or when the one-off fill saves the copy of a check-in sent before copies
 * existed — and frozen with it (lib/check-in/sent-snapshot.ts). Pure: the
 * caller reads the goal in force on the check-in's day, the readings and the
 * trend, and hands them in.
 */

/** One check-in on the trend: when it was sent and what it reported. */
export type TrendCheckIn = {
  createdAt: string;
  weight?: number;
  bodyFatPercentage?: number;
};

type GoalTrend = {
  /** kg per week over the check-ins that carried a weight; undefined below two of them. */
  avgWeeklyWeightChange?: number;
  /** Percentage points per reading over the check-ins that carried a body fat. */
  avgBodyFatChange?: number;
};

/**
 * The TREND behind `isOnTrack`, over the ten check-ins up to and including the
 * judged one, newest first — body fat's only trend signal, and weight's when
 * there is no deadline to pace against.
 */
export function checkInTrend(checkIns: TrendCheckIn[]): GoalTrend {
  const trend: GoalTrend = {};

  const weighed = checkIns.filter((checkIn) => checkIn.weight);
  if (weighed.length >= 2) {
    const oldest = weighed[weighed.length - 1];
    const newest = weighed[0];
    const daysBetween = calculateDaysBetween(newest.createdAt, oldest.createdAt);
    if (daysBetween > 0) {
      const totalChange = newest.weight! - oldest.weight!;
      trend.avgWeeklyWeightChange = Number(((totalChange / daysBetween) * 7).toFixed(2));
    }
  }

  const measured = checkIns.filter((checkIn) => checkIn.bodyFatPercentage);
  if (measured.length >= 2) {
    const oldest = measured[measured.length - 1].bodyFatPercentage!;
    const newest = measured[0].bodyFatPercentage!;
    trend.avgBodyFatChange = Number(((newest - oldest) / measured.length).toFixed(2));
  }

  return trend;
}

/** A reading on the client's calendar. */
export type DatedReading = { value: number; date: string };

/**
 * The reading "as of" an anchor day — the newest on or before it, else the
 * earliest after it — once the reading being sent is written. At Send the
 * check-in's own reading is not in the log yet (it is written just after the
 * check-in), so each as-of read is merged with it here: dated the check-in's
 * day and written last, it wins a tie on its day either way, because a day's
 * value is the reading written last.
 */
export function withSentReading(
  found: DatedReading | undefined,
  sent: DatedReading | undefined,
  anchor: string
): DatedReading | undefined {
  if (!sent) return found;
  if (!found) return sent;
  const sentOnOrBefore = sent.date <= anchor;
  const foundOnOrBefore = found.date <= anchor;
  if (sentOnOrBefore && foundOnOrBefore) return sent.date >= found.date ? sent : found;
  if (sentOnOrBefore) return sent;
  if (foundOnOrBefore) return found;
  return sent.date <= found.date ? sent : found;
}

type MetricPair = { weight?: number; bodyFat?: number };

/**
 * The goal judged and where the client stood against it on the check-in's day:
 * the goal (or none), and the rows the goal section draws — the position, the
 * goal's start, the client's baseline beside it, the verdict, the pace and the
 * deadline, counted from the check-in's day.
 */
export function composeGoalSection(input: {
  /** The goal in force on the check-in's day, with that day's deadline. */
  goal: GoalOnDay | null;
  /** When the check-in was sent, and the client's zone — the clock the deadline is counted on. */
  instant: Date;
  timezone: string;
  /** The reading as of the check-in's day: its own, else the newest before it. */
  standing: MetricPair;
  /** The client's readings on the goal's start day, which its progress runs from. */
  goalStart: MetricPair;
  /** The client's baseline — their reading as of their start date. */
  baseline: MetricPair;
  trend: GoalTrend;
}): Pick<SentSnapshot, "goal" | "goalProgress"> {
  const { goal, standing, goalStart, baseline } = input;
  const effectiveGoal = resolveEffectiveGoal(goal);

  // Whole days from the check-in's day to the deadline, on the client's
  // calendar. "T00:00:00" parses local midnight to match getTodayInTimezone
  // (NOT parseISODate, which is UTC midnight).
  const deadline = effectiveGoal.deadline ?? undefined;
  const daysRemaining = deadline
    ? differenceInDays(
        new Date(deadline + "T00:00:00"),
        getTodayInTimezone(input.timezone, input.instant)
      )
    : null;
  const weeksRemaining = daysRemaining !== null ? daysRemaining / 7 : null;

  const goalProgress = deriveGoalProgress({
    effectiveGoal: { ...effectiveGoal, type: goal?.type ?? null },
    client: {
      currentWeight: standing.weight,
      currentBodyFatPercentage: standing.bodyFat,
      // Without a baseline the reading then stands in, as the review always has.
      startingWeight: baseline.weight ?? standing.weight,
      startingBodyFatPercentage: baseline.bodyFat ?? standing.bodyFat,
      goalStartWeight: goalStart.weight,
      goalStartBodyFatPercentage: goalStart.bodyFat,
    },
    trend: input.trend,
    daysRemaining,
    weeksRemaining,
  });

  return {
    goal: goal
      ? {
          id: goal.id,
          name: goal.name,
          type: goal.type,
          targetWeight: goal.targetWeight,
          targetBodyFatPercentage: goal.targetBodyFatPercentage,
          startsOn: goal.startsOn,
          deadline: goal.deadline,
        }
      : null,
    goalProgress,
  };
}
