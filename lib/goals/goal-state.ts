/**
 * Goal-chip state for the Overview status card (the sanctioned replacement for
 * the old Math.abs logic, which could not tell "passed the goal" from "still
 * short of it"). Pure and unit-agnostic — callers pass start/current/goal in
 * one consistent unit (display-unit weight, body-fat %).
 */
export type GoalStateInput = {
  start: number | null;
  current: number | null;
  goal: number | null;
};

export type GoalState =
  | { state: "reached" }
  | { state: "beyond"; amount: number }
  | { state: "gap"; amount: number };

// Within this distance of the goal (in the caller's unit) counts as reached —
// absorbs float noise and meaninglessly small residuals like 0.04 kg.
export const GOAL_REACHED_TOLERANCE = 0.05;

export function goalState({ start, current, goal }: GoalStateInput): GoalState | null {
  if (current == null || goal == null) return null;
  if (Math.abs(current - goal) <= GOAL_REACHED_TOLERANCE) return { state: "reached" };

  // Direction of travel: negative = loss goal, positive = gain goal. Without a
  // start value (or when start === goal) the direction is unknowable, so
  // "beyond" can never be claimed — only reached/gap.
  const direction = start == null ? 0 : Math.sign(goal - start);
  if (direction < 0 && current < goal) return { state: "beyond", amount: goal - current };
  if (direction > 0 && current > goal) return { state: "beyond", amount: current - goal };
  return { state: "gap", amount: Math.abs(goal - current) };
}
