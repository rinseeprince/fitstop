import type { EffectiveGoal } from "./resolve-effective-goal";

/**
 * Goal-drift detection (pure, Session 7.8). Compares the goal a nutrition version
 * was built for (its frozen snapshot: `goal_weight_kg` + `goal_deadline`) with the
 * goal in force on a day (the effective-goal resolver result) — the comparison the
 * out-of-date rule makes for each of a version's days from today
 * (`lib/nutrition/nutrition-out-of-date.ts`). Distinct from the weight-delta
 * regeneration note, which compares the client's CURRENT weight to the plan's
 * base weight, not the goal.
 */
type GoalDrift = {
  changed: boolean;
  /** The active plan's frozen snapshot. */
  planGoalWeightKg: number | null;
  planDeadline: string | null;
  /** The goal in force on the day judged (resolver). */
  currentGoalWeightKg: number | null;
  currentDeadline: string | null;
};

/** kg tolerance to ignore float / display round-trip noise when comparing weights. */
const WEIGHT_EPSILON_KG = 0.1;

export function detectGoalDrift(
  planSnapshot: { goalWeightKg: number | null; deadline: string | null },
  effective: Pick<EffectiveGoal, "goalWeightKg" | "deadline">
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
  };
}
