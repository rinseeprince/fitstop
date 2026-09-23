import { formatHistoryDate } from "@/lib/date-helpers";
import { formatGoalAmount, goalProgressChip, type GoalChipTone } from "./goal-chip";
import { goalState } from "./goal-state";
import { goalDirection, type GoalMetric, type GoalType } from "./goal-types";
import type { GoalHistoryRow } from "@/types/client-goals";

/**
 * A goal's result in the Journey's goals table (docs/MEASUREMENT-LOG-PLAN.md
 * §6 commit 8d3), worked out from the measurement log and never stored,
 * through the goal card's own verdict (`goalState`, in the direction the
 * goal's type sets) in the viewer's units — where the card judges — so the two
 * cannot disagree. Per target:
 *
 *  - an ended goal: reached, with the first day its target was met; else,
 *    when its deadline came while it ran with a reading by then, missed by how
 *    far on that day; else short by how far on its last day;
 *  - today's goal: the goal card's chip, from the same start and newest readings;
 *  - a planned goal: planned.
 *
 * A goal with no targets shows its weight change over its days, once a reading
 * was taken after the one it runs from. A corrected reading corrects the
 * result: the log is the truth of what the client weighed.
 */

/** One metric's day-values, ascending by day, in the viewer's unit. */
export type ReadingDays = readonly { date: string; value: number }[];

export type GoalResultLine =
  | { kind: "verdict"; text: string; tone: GoalChipTone }
  | { kind: "planned" }
  /** The weight change over a goal with no targets, in the viewer's unit. */
  | { kind: "change"; amount: number }
  | { kind: "noReading" };

type ResultGoal = Pick<GoalHistoryRow, "status" | "startsOn" | "endsOn" | "deadline"> & {
  type: GoalType;
  /** In the viewer's units. */
  targets: Record<GoalMetric, number | null>;
  /**
   * Today's goal: the readings on its start day as the goals read carries
   * them — what the goal card measures from — in the viewer's units.
   */
  startReadings?: Record<GoalMetric, number | null>;
};

type Reading = ReadingDays[number];

/** The newest reading on or before `day`. */
function readingAsOf(days: ReadingDays, day: string): Reading | null {
  let found: Reading | null = null;
  for (const point of days) {
    if (point.date > day) break;
    found = point;
  }
  return found;
}

const asOf = (days: ReadingDays, day: string): number | null => readingAsOf(days, day)?.value ?? null;

/** The reading a goal's progress runs from: the newest on or before its start day, else the first after it. */
function startReading(days: ReadingDays, day: string): Reading | null {
  return readingAsOf(days, day) ?? days.find((point) => point.date > day) ?? null;
}

function startOf(goal: ResultGoal, metric: GoalMetric, days: ReadingDays): number | null {
  return goal.startReadings ? goal.startReadings[metric] : (startReading(days, goal.startsOn)?.value ?? null);
}

function endedVerdict(
  goal: ResultGoal,
  endsOn: string,
  metric: GoalMetric,
  target: number,
  days: ReadingDays,
  unit: string
): GoalResultLine {
  const start = startReading(days, goal.startsOn)?.value ?? null;
  const direction = goalDirection(goal.type, metric, target, start);
  const judge = (current: number | null) => goalState({ start, current, goal: target, direction });
  const met = (current: number | null) => {
    const state = judge(current);
    return state !== null && state.state !== "gap";
  };

  // Met on its first day when the reading then already met it, else on the
  // first day a reading during it did.
  const metOn = met(asOf(days, goal.startsOn))
    ? goal.startsOn
    : days.find((point) => point.date > goal.startsOn && point.date <= endsOn && met(point.value))?.date;
  if (metOn) return { kind: "verdict", text: `Reached ${formatHistoryDate(metOn)}`, tone: "positive" };

  // Not met: judged on its deadline when that came while it ran and a reading
  // stood by then, else on its last day — a gap, since no reading through its
  // last day met it.
  const onDeadline = goal.deadline !== null && goal.deadline <= endsOn ? asOf(days, goal.deadline) : null;
  const state = judge(onDeadline ?? asOf(days, endsOn));
  if (state?.state !== "gap") return { kind: "noReading" };
  const amount = formatGoalAmount(state.amount, unit);
  return {
    kind: "verdict",
    text: onDeadline !== null ? `Missed by ${amount}` : `Ended ${amount} short`,
    tone: "warning",
  };
}

export function goalResult(
  goal: ResultGoal,
  readings: Record<GoalMetric, ReadingDays>,
  weightUnit: string
): GoalResultLine[] {
  if (goal.status === "planned") return [{ kind: "planned" }];

  const targets = (["weight", "bodyFat"] as const).flatMap((metric) => {
    const target = goal.targets[metric];
    return target === null ? [] : [{ metric, target }];
  });
  if (targets.length === 0) {
    const days = readings.weight;
    const start = startReading(days, goal.startsOn);
    const end =
      goal.status === "ended" && goal.endsOn ? readingAsOf(days, goal.endsOn) : (days[days.length - 1] ?? null);
    // A change needs a reading taken after the one it runs from.
    return [
      start && end && end.date > start.date ? { kind: "change", amount: end.value - start.value } : { kind: "noReading" },
    ];
  }

  return targets.map(({ metric, target }): GoalResultLine => {
    const days = readings[metric];
    const unit = metric === "weight" ? weightUnit : "%";
    if (goal.status === "ended" && goal.endsOn) return endedVerdict(goal, goal.endsOn, metric, target, days, unit);

    const chip = goalProgressChip({
      type: goal.type,
      metric,
      start: startOf(goal, metric, days),
      current: days[days.length - 1]?.value ?? null,
      target,
      unit,
    });
    return chip ? { kind: "verdict", ...chip } : { kind: "noReading" };
  });
}
