import type { EffectiveGoal } from "./resolve-effective-goal";

/**
 * Goal-drift detection (pure, Session 7.8). Compares the goal an active nutrition
 * plan was built against (its frozen snapshot: `goal_weight_kg` + `goal_deadline`)
 * with the goal that drives the client NOW (the effective-goal resolver result).
 * When they differ, the coach sees a "Goal changed — regenerate" prompt — distinct
 * from the weight-delta regeneration banner (which compares the client's CURRENT
 * weight to the plan's base weight, not the goal).
 */
export type GoalDrift = {
  changed: boolean;
  /** The active plan's frozen snapshot. */
  planGoalWeightKg: number | null;
  planDeadline: string | null;
  /** The current effective goal (resolver). */
  currentGoalWeightKg: number | null;
  currentDeadline: string | null;
  source: EffectiveGoal["source"];
};

/** kg tolerance to ignore float / display round-trip noise when comparing weights. */
const WEIGHT_EPSILON_KG = 0.1;

export function detectGoalDrift(
  planSnapshot: { goalWeightKg: number | null; deadline: string | null },
  effective: Pick<EffectiveGoal, "goalWeightKg" | "deadline" | "source">
): GoalDrift {
  const planWeight = planSnapshot.goalWeightKg;
  const currentWeight = effective.goalWeightKg;

  // A weight changed if one side has a target and the other doesn't, or both have
  // targets that differ by more than the epsilon.
  const weightChanged =
    (planWeight == null) !== (currentWeight == null) ||
    (planWeight != null &&
      currentWeight != null &&
      Math.abs(planWeight - currentWeight) > WEIGHT_EPSILON_KG);

  const deadlineChanged = (planSnapshot.deadline ?? null) !== (effective.deadline ?? null);

  return {
    changed: weightChanged || deadlineChanged,
    planGoalWeightKg: planWeight,
    planDeadline: planSnapshot.deadline,
    currentGoalWeightKg: currentWeight,
    currentDeadline: effective.deadline,
    source: effective.source,
  };
}
