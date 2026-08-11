import { CALORIES_PER_KG } from "@/lib/constants";

/**
 * The one equation between a weekly body-mass rate and a daily calorie delta,
 * in both directions. Pure, shared by the server calculator and the browser
 * builder so a preview can never disagree with a save.
 *
 * SIGN CONVENTION — symmetric and signed on both sides:
 *   positive = surplus / gain   (eating above TDEE, weight going up)
 *   negative = deficit / loss   (eating below TDEE, weight going down)
 *
 * `calculateBaselineCalories` keeps its legacy deficit-positive
 * `requiredDailyDeficit` at its own boundary (the targets block renders
 * `> 0 ? "−" : "+"` from it); callers there negate at the call site rather
 * than this module carrying two conventions.
 *
 * No rounding here — these feed further arithmetic; display rounding belongs
 * to the renderer.
 */

/** kg/week (signed, + = gain) → kcal/day (signed, + = surplus). */
export function weeklyRateToDailyDelta(rateKgPerWeek: number): number {
  return (rateKgPerWeek * CALORIES_PER_KG) / 7;
}

/** kcal/day (signed, + = surplus) → kg/week (signed, + = gain). */
export function dailyDeltaToWeeklyRate(deltaKcalPerDay: number): number {
  return (deltaKcalPerDay * 7) / CALORIES_PER_KG;
}
