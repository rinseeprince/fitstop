import { CALORIES_PER_KG } from "@/lib/constants";
import { addDaysToDateString, dateStringToDayNumber } from "@/lib/date-helpers";

/**
 * Rate-first goal arithmetic: the inverse of the deadline-driven calculator.
 *
 * `calculateBaselineCalories` (`services/nutrition-service.ts`) takes a target
 * weight plus a deadline and derives the rate internally. This module owns the
 * other direction — given a rate, what is the calorie delta, and what deadline
 * does it land on — plus the safety caps and calorie floor that BOTH directions
 * share, so the numbers exist in one place rather than two.
 *
 * Everything here is PURE and takes `today` explicitly. That is load-bearing, not
 * stylistic: this module is destined for the coach's browser, and two of its
 * inputs are dates on the CLIENT's calendar. A `new Date()` fallback would
 * silently substitute the coach's device date (see ARCHITECTURE → Timezone model,
 * "whose calendar is this date on?").
 *
 * Date arithmetic goes through `dateStringToDayNumber` / `addDaysToDateString`,
 * which are UTC-anchored end to end. The calculator's own date math is a
 * local-midnight parse of `today` compared against UTC-midnight parses of the
 * deadline; `Math.round` absorbs the offset below ±12h, so it is correct on a
 * UTC server and drifts a day at +12 and beyond. Reproducing that here would turn
 * a dormant server bug into a live one for every coach in NZ/Kiritimati.
 */

export type GoalGender = "male" | "female" | "other" | null | undefined;

// Gender-specific safety ceilings and the absolute calorie floor. Module-local
// named constants rather than lib/constants.ts entries — after this extraction
// each value appears exactly once, and this is the precedent set by
// `lib/check-in/goal-pace.ts`'s SAFE_CEILING_FRACTION.
const MAX_LOSS_KG_PER_WEEK = { female: 0.75, other: 1.0 } as const;
const MAX_GAIN_KG_PER_WEEK = { female: 0.35, other: 0.5 } as const;
const MIN_DAILY_CALORIES = { female: 1200, other: 1500 } as const;

export type RateSafety = {
  maxLossKgPerWeek: number;
  maxGainKgPerWeek: number;
  minDailyCalories: number;
};

/**
 * The safety envelope for a client.
 *
 * **An unset gender takes the MALE ceilings.** That is the shipped behaviour
 * (`gender === "female" ? … : …`), reached in practice because the orchestrator
 * casts `client.gender` with no runtime narrowing — so `"other"`, null and
 * undefined all land here. Preserved deliberately; whether to surface it to the
 * coach is a separate product decision.
 */
export function getRateSafety(gender: GoalGender): RateSafety {
  const key = gender === "female" ? "female" : "other";
  return {
    maxLossKgPerWeek: MAX_LOSS_KG_PER_WEEK[key],
    maxGainKgPerWeek: MAX_GAIN_KG_PER_WEEK[key],
    minDailyCalories: MIN_DAILY_CALORIES[key],
  };
}

/** Signed daily calorie delta for a weekly rate. Negative = deficit. */
export function dailyCalorieDeltaFromRate(rateKgPerWeek: number): number {
  return (rateKgPerWeek * CALORIES_PER_KG) / 7;
}

/** The inverse of {@link dailyCalorieDeltaFromRate}. */
export function rateFromDailyCalorieDelta(dailyCalorieDelta: number): number {
  return (dailyCalorieDelta * 7) / CALORIES_PER_KG;
}

/**
 * The daily calorie MAGNITUDE for a rate — the shape the deadline-driven
 * calculator works in, where direction is carried separately.
 */
export function dailyCalorieMagnitudeFromRate(rateKgPerWeek: number): number {
  return (Math.abs(rateKgPerWeek) * CALORIES_PER_KG) / 7;
}

export type CappedRate = {
  /** The rate after capping — unchanged when within the envelope. */
  rateKgPerWeek: number;
  capped: boolean;
  /** The ceiling that applied, as a positive magnitude. */
  capKgPerWeek: number;
  /** Coach-visible copy. Byte-identical to the calculator's existing strings. */
  warning: string | null;
};

/**
 * Clamp a weekly rate into the gender safety envelope.
 *
 * Returns the cap STRUCTURALLY (`capped`, `capKgPerWeek`) as well as the warning
 * string. The calculator only ever pushed English into a flat `string[]`, which a
 * per-row preview cannot render without parsing prose.
 */
export function capWeeklyRate(rateKgPerWeek: number, gender: GoalGender): CappedRate {
  const { maxLossKgPerWeek, maxGainKgPerWeek } = getRateSafety(gender);

  if (rateKgPerWeek < -maxLossKgPerWeek) {
    return {
      rateKgPerWeek: -maxLossKgPerWeek,
      capped: true,
      capKgPerWeek: maxLossKgPerWeek,
      warning: `Weekly deficit capped at ${maxLossKgPerWeek}kg/week for safety. Goal timeline may need adjustment.`,
    };
  }

  if (rateKgPerWeek > maxGainKgPerWeek) {
    return {
      rateKgPerWeek: maxGainKgPerWeek,
      capped: true,
      capKgPerWeek: maxGainKgPerWeek,
      warning: `Weekly surplus capped at ${maxGainKgPerWeek}kg/week for optimal muscle gain. Goal timeline may need adjustment.`,
    };
  }

  return {
    rateKgPerWeek,
    capped: false,
    capKgPerWeek: rateKgPerWeek < 0 ? maxLossKgPerWeek : maxGainKgPerWeek,
    warning: null,
  };
}

export type FlooredCalories = {
  calories: number;
  floored: boolean;
  floor: number;
  warning: string | null;
};

/**
 * The safety envelope is ASSUMED when the client has no gender on file.
 *
 * `getRateSafety` keys on `gender === "female"`, so null/undefined fall to the
 * higher ceiling and the lower floor — the less cautious of the two envelopes.
 * `"other"` is excluded on purpose: the coach chose it, so nothing was assumed.
 */
export function isSafetyEnvelopeAssumed(gender: GoalGender): boolean {
  return gender == null;
}

/**
 * Coach-visible copy for the assumed envelope, emitted ONLY when a cap or floor
 * actually applied (owner decision 2026-07-29). An unset gender that never trips
 * a limit changed nothing, and warning about it would be noise on every plan.
 */
export function assumedSafetyEnvelopeWarning(
  gender: GoalGender,
  limitApplied: boolean
): string | null {
  if (!limitApplied || !isSafetyEnvelopeAssumed(gender)) return null;
  return "Safety limits were assumed: this client has no gender set, so the higher weekly ceiling and lower calorie floor were used. Set it on their profile to apply the right limits.";
}

/** Raise a calorie target to the gender minimum. */
export function applyCalorieFloor(calories: number, gender: GoalGender): FlooredCalories {
  const { minDailyCalories } = getRateSafety(gender);

  if (calories < minDailyCalories) {
    return {
      calories: minDailyCalories,
      floored: true,
      floor: minDailyCalories,
      warning: `Calorie target raised to minimum safe level (${minDailyCalories} cal/day). Consider adjusting goal timeline.`,
    };
  }

  return { calories, floored: false, floor: minDailyCalories, warning: null };
}

/**
 * Inclusive day count from the effective start to the deadline.
 *
 * Mirrors the calculator's two semantics exactly: a start date in the future
 * counts from the start (not today), a start already elapsed counts from today,
 * and the count includes both endpoints. Expressed in day numbers, so the answer
 * does not move with the runtime's timezone.
 */
export function daysToDeadline(input: {
  deadline: string;
  today: string;
  /** Defaults to `today` when the goal carries no start date. */
  startDate?: string | null;
}): number {
  const todayNum = dateStringToDayNumber(input.today);
  const startNum = input.startDate ? dateStringToDayNumber(input.startDate) : todayNum;
  const effectiveStart = Math.max(startNum, todayNum);
  return dateStringToDayNumber(input.deadline) - effectiveStart + 1;
}

export type TargetToRateInput = {
  currentWeightKg: number;
  goalWeightKg: number;
  deadline: string;
  today: string;
  startDate?: string | null;
};

/**
 * Target + deadline → rate. Returns null when the deadline has already passed,
 * which is the calculator's maintenance case rather than an error.
 */
export function deriveRateFromTarget(input: TargetToRateInput): {
  rateKgPerWeek: number;
  days: number;
} | null {
  const days = daysToDeadline(input);
  if (days <= 0) return null;

  const weightChangeKg = input.goalWeightKg - input.currentWeightKg;
  return { rateKgPerWeek: weightChangeKg / (days / 7), days };
}

export type RateToDeadlineInput = {
  currentWeightKg: number;
  goalWeightKg: number;
  rateKgPerWeek: number;
  today: string;
  startDate?: string | null;
};

/**
 * Rate → deadline, the inverse of {@link deriveRateFromTarget}.
 *
 * Returns null when no deadline exists: a zero rate is maintenance and never
 * arrives, a rate pointing away from the target never arrives either, and a
 * client already at their goal has nothing to derive.
 */
export function deriveDeadlineFromRate(input: RateToDeadlineInput): {
  deadline: string;
  days: number;
} | null {
  const weightChangeKg = input.goalWeightKg - input.currentWeightKg;
  if (input.rateKgPerWeek === 0 || weightChangeKg === 0) return null;
  if (Math.sign(weightChangeKg) !== Math.sign(input.rateKgPerWeek)) return null;

  const days = Math.round((weightChangeKg * 7) / input.rateKgPerWeek);
  if (days <= 0) return null;

  // The day count is inclusive of both endpoints, so the deadline sits days-1
  // after the start — the exact inverse of daysToDeadline's `+ 1`.
  const start = input.startDate && input.startDate > input.today ? input.startDate : input.today;
  return { deadline: addDaysToDateString(start, days - 1), days };
}

export type RateFirstResult = {
  baselineCalories: number;
  /** Signed, after capping. Negative = deficit. */
  dailyCalorieDelta: number;
  /** What the caller asked for. */
  requestedRateKgPerWeek: number;
  /**
   * The rate the returned calorie target ACTUALLY delivers. Differs from the
   * request when a cap or the floor bit — including after a floor, which the
   * deadline-driven calculator does not re-derive (it returns a pre-floor rate
   * beside a post-floor calorie target).
   */
  appliedRateKgPerWeek: number;
  capped: boolean;
  capKgPerWeek: number;
  floored: boolean;
  floor: number;
  warnings: string[];
};

/**
 * The rate-first entry point: given a weekly rate, what does the client eat?
 *
 * Shares `capWeeklyRate` and `applyCalorieFloor` with the deadline-driven
 * calculator, so the two cannot drift apart on what counts as safe.
 */
export function calculateBaselineCaloriesFromRate(input: {
  tdee: number;
  rateKgPerWeek: number;
  gender: GoalGender;
}): RateFirstResult {
  const capped = capWeeklyRate(input.rateKgPerWeek, input.gender);
  const dailyCalorieDelta = dailyCalorieDeltaFromRate(capped.rateKgPerWeek);
  const floored = applyCalorieFloor(
    Math.round(input.tdee + dailyCalorieDelta),
    input.gender
  );

  return {
    baselineCalories: floored.calories,
    dailyCalorieDelta,
    requestedRateKgPerWeek: input.rateKgPerWeek,
    // Re-derived from the target actually returned. A floored day runs a smaller
    // deficit than the request, and saying otherwise is how a preview shows a
    // rate the client will never hit.
    appliedRateKgPerWeek: floored.floored
      ? rateFromDailyCalorieDelta(floored.calories - input.tdee)
      : capped.rateKgPerWeek,
    capped: capped.capped,
    capKgPerWeek: capped.capKgPerWeek,
    floored: floored.floored,
    floor: floored.floor,
    warnings: [
      capped.warning,
      floored.warning,
      assumedSafetyEnvelopeWarning(
        input.gender,
        capped.capped || floored.floored
      ),
    ].filter((w): w is string => w !== null),
  };
}
