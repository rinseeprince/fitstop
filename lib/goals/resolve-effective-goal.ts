/**
 * The goal that drives the calculator and the pace checks, from the goal in
 * force on a day (migration 193 — `lib/goals/goal-timeline.ts` decides which
 * goal and which deadline a day has). A null weight target means
 * **maintenance** (`goalWeightKg: null`), and so does a goal with no deadline
 * in the calculator, which needs both.
 *
 * PURE: callers read the goal and pass it in. Kilograms, canonical — there is
 * no unit to convert. A goal has no start of its own for the calculator: the
 * window a nutrition deficit is spread over begins at the day the plan takes
 * effect (docs/MEASUREMENT-LOG-PLAN.md commit 8bb).
 */

export type EffectiveGoal = {
  /** kg, or null for maintenance / no weight target. */
  goalWeightKg: number | null;
  goalBodyFatPercentage: number | null;
  /** ISO YYYY-MM-DD, or null when no deadline is set. */
  deadline: string | null;
};

/** The parts of a goal on a day the calculator reads. null = no goal in force. */
type GoalTargetsOnDay = {
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  deadline: string | null;
};

export function resolveEffectiveGoal(goal: GoalTargetsOnDay | null): EffectiveGoal {
  return {
    goalWeightKg: goal?.targetWeight ?? null,
    goalBodyFatPercentage: goal?.targetBodyFatPercentage ?? null,
    deadline: goal?.deadline ?? null,
  };
}
