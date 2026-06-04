/**
 * Terminal goal-outcome evaluation (pure). Consumed by Session 7.9's manual
 * goal-complete path and Session 7.10's roadmap-completion path. Decides whether
 * a finished goal was achieved, given start/end metrics and the target.
 *
 * Weight is required (no weight target → inconclusive). Body fat is optional and
 * conjunctive: when a body-fat target is present AND measurable, BOTH the weight
 * and body-fat targets must be met. Otherwise weight alone decides.
 */

export type GoalOutcome = "achieved" | "not_achieved" | "inconclusive";

/** Weight tolerance is the larger of 1.0 kg or 1.5% of the target weight. */
export const WEIGHT_TOLERANCE_KG_FLOOR = 1.0;
export const WEIGHT_TOLERANCE_FRACTION = 0.015;
/** Body-fat tolerance in percentage points. */
export const BODY_FAT_TOLERANCE_PP = 1.0;

export function weightToleranceKg(targetWeightKg: number): number {
  return Math.max(
    WEIGHT_TOLERANCE_KG_FLOOR,
    Math.abs(targetWeightKg) * WEIGHT_TOLERANCE_FRACTION
  );
}

export type EvaluateGoalOutcomeInput = {
  /** Direction anchor. null → judge purely on proximity to target. */
  startWeightKg: number | null;
  /** Latest measured weight. null → cannot judge → inconclusive. */
  endWeightKg: number | null;
  /** kg, or null for no weight target (maintenance) → inconclusive. */
  targetWeightKg: number | null;
  startBodyFat?: number | null;
  endBodyFat?: number | null;
  targetBodyFat?: number | null;
};

/**
 * Did `end` reach `target` from `start`, within `tolerance`?
 * - no start (no direction) → within tolerance of target
 * - start === target (maintenance) → stayed within tolerance
 * - need to gain (target > start) → at or above target − tolerance
 * - need to lose (target < start) → at or below target + tolerance
 */
function reachedTarget(
  end: number,
  target: number,
  start: number | null,
  tolerance: number
): boolean {
  if (start == null) return Math.abs(end - target) <= tolerance;
  const direction = Math.sign(target - start);
  if (direction === 0) return Math.abs(end - target) <= tolerance;
  if (direction > 0) return end >= target - tolerance;
  return end <= target + tolerance;
}

export function evaluateGoalOutcome(
  input: EvaluateGoalOutcomeInput
): GoalOutcome {
  const {
    startWeightKg,
    endWeightKg,
    targetWeightKg,
    startBodyFat,
    endBodyFat,
    targetBodyFat,
  } = input;

  // Weight is required to decide an outcome.
  if (targetWeightKg == null || endWeightKg == null) return "inconclusive";

  const weightAchieved = reachedTarget(
    endWeightKg,
    targetWeightKg,
    startWeightKg,
    weightToleranceKg(targetWeightKg)
  );

  // Body fat is conjunctive only when it has a target AND a measurable end value.
  const bodyFatAssessable = targetBodyFat != null && endBodyFat != null;
  if (bodyFatAssessable) {
    const bodyFatAchieved = reachedTarget(
      endBodyFat,
      targetBodyFat,
      startBodyFat ?? null,
      BODY_FAT_TOLERANCE_PP
    );
    return weightAchieved && bodyFatAchieved ? "achieved" : "not_achieved";
  }

  return weightAchieved ? "achieved" : "not_achieved";
}
