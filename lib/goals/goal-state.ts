/**
 * Goal-chip state for the Overview status card (the sanctioned replacement for
 * the old Math.abs logic, which could not tell "passed the goal" from "still
 * short of it"). Pure and unit-agnostic — callers pass start/current/goal in
 * one consistent unit (display-unit weight, body-fat %).
 */
type GoalStateInput = {
  start: number | null;
  current: number | null;
  goal: number | null;
  /**
   * The way the goal is approached — the goal type's where it decides one
   * (`goalDirection`, lib/goals/goal-types.ts); omitted, it is the side of the
   * start the goal sits on.
   */
  direction?: -1 | 0 | 1;
};

type GoalState =
  | { state: "reached" }
  | { state: "beyond"; amount: number }
  | { state: "gap"; amount: number };

// Within this distance of the goal (in the caller's unit) counts as reached —
// absorbs float noise and meaninglessly small residuals like 0.04 kg.
export const GOAL_REACHED_TOLERANCE = 0.05;

export function goalState({ start, current, goal, direction: given }: GoalStateInput): GoalState | null {
  if (current == null || goal == null) return null;
  if (Math.abs(current - goal) <= GOAL_REACHED_TOLERANCE) return { state: "reached" };

  // Direction of travel: negative = loss goal, positive = gain goal. Without a
  // given direction or a start value (or when start === goal) it is
  // unknowable, so "beyond" can never be claimed — only reached/gap.
  const direction = given ?? (start == null ? 0 : Math.sign(goal - start));
  if (direction < 0 && current < goal) return { state: "beyond", amount: goal - current };
  if (direction > 0 && current > goal) return { state: "beyond", amount: current - goal };
  return { state: "gap", amount: Math.abs(goal - current) };
}
