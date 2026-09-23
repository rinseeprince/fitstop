import { goalState } from "./goal-state";
import { goalDirection, type GoalMetric, type GoalType } from "./goal-types";

export type GoalChipTone = "positive" | "warning";

/**
 * How far a client is from one of their goal's targets, in words — the coach's
 * goal card and the client's own goal card say it the same way. `goalState`
 * judges reached / beyond / gap in the direction the goal is approached: the
 * goal type's where it decides one, else the side of the goal's start reading
 * the target sits on (`goalDirection`). "Under" vs "over" follows that same
 * direction, so a goal with none — no type direction and no start reading —
 * can only read reached or to go.
 *
 * `start`, `current` and `target` in one unit, any unit: converting never
 * moves a reading to the other side of its target, so the direction holds.
 * `unit` is what the amount is written with ("kg", "lbs", "%").
 */
export function goalProgressChip({
  type,
  metric,
  start,
  current,
  target,
  unit,
}: {
  type: GoalType | null | undefined;
  metric: GoalMetric;
  start: number | null | undefined;
  current: number | null | undefined;
  target: number | null | undefined;
  unit: string;
}): { text: string; tone: GoalChipTone } | null {
  if (target == null) return null;
  const direction = goalDirection(type, metric, target, start);
  const state = goalState({ start: start ?? null, current: current ?? null, goal: target, direction });
  if (!state) return null;

  if (state.state === "reached") return { text: "Goal reached", tone: "positive" };

  const amount = `${state.amount.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}`;
  if (state.state === "beyond") {
    return { text: `${amount} ${direction < 0 ? "under" : "over"} goal`, tone: "positive" };
  }
  return { text: `${amount} to go`, tone: "warning" };
}
