import type { GoalPaceStatus } from "@/types/check-in";

export type GoalPace = {
  // kg per week needed to reach the goal by the deadline.
  requiredRate: number;
  // kg per week considered safe (1% of current bodyweight).
  safeCeiling: number;
  ratio: number;
  status: GoalPaceStatus;
};

// Safe weekly weight-change ceiling as a fraction of current bodyweight (1.0%).
const SAFE_CEILING_FRACTION = 0.01;

type GoalPaceInput = {
  remainingKg: number;
  weeksRemaining: number;
  currentWeightKg?: number;
};

/**
 * Pace-aware goal status. Compares the rate required to hit the goal by the
 * deadline against a safe weekly ceiling (1% of bodyweight). Returns null when
 * pace cannot be assessed (no deadline or no current weight).
 *
 * - requiredRate <= safeCeiling           -> on_track
 * - 1x to 1.5x the ceiling                -> behind_pace
 * - above 1.5x the ceiling (or past due)  -> unrealistic
 */
export function computeGoalPace({
  remainingKg,
  weeksRemaining,
  currentWeightKg,
}: GoalPaceInput): GoalPace | null {
  if (!currentWeightKg || currentWeightKg <= 0) return null;

  const safeCeiling = Number((currentWeightKg * SAFE_CEILING_FRACTION).toFixed(2));
  const absRemaining = Math.abs(remainingKg);

  // Goal effectively reached.
  if (absRemaining < 0.05) {
    return { requiredRate: 0, safeCeiling, ratio: 0, status: "on_track" };
  }

  // Deadline reached but the goal has not been met: not achievable safely.
  if (weeksRemaining <= 0) {
    return { requiredRate: Infinity, safeCeiling, ratio: Infinity, status: "unrealistic" };
  }

  const requiredRate = Number((absRemaining / weeksRemaining).toFixed(2));
  const ratio = requiredRate / safeCeiling;
  const status: GoalPaceStatus =
    ratio <= 1 ? "on_track" : ratio <= 1.5 ? "behind_pace" : "unrealistic";

  return { requiredRate, safeCeiling, ratio: Number(ratio.toFixed(2)), status };
}
