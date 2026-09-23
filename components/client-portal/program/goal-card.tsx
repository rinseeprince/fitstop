"use client";

import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import { formatBlockDate } from "@/lib/blocks/block-format";
import { goalProgressChip } from "@/lib/goals/goal-chip";
import { goalTypeBesideName } from "@/lib/goals/goal-types";
import type { ClientJourney } from "@/types/client-journey";

/** Converted to the viewer's unit and rounded to 1dp, so "to go" subtracts two shown numbers. */
function shownWeight(kg: number | null | undefined, preference: UnitSystem): number | null {
  return kg == null ? null : Number(formatWeight(kg, preference).value.toFixed(1));
}

/**
 * The client's goal, at the top of the Program tab — every client with a goal
 * sees it, with a block or without one: its name, its type where the name does
 * not say it, each target with how far they are from it (the words the coach's
 * goal card uses, `goalProgressChip`), the deadline, and the goal's own words.
 * A planned goal is not on the wire before its day, so it shows from then.
 */
export function GoalCard({ goal }: { goal: ClientJourney["goal"] }) {
  const { preference } = useUnits();
  if (!goal.name || !goal.type) return null;

  const unit = formatWeight(0, preference).unit;
  const readings = goal.readings ?? null;
  const type = goalTypeBesideName(goal.type, goal.name);

  const targets: string[] = [];
  const weightTarget = shownWeight(goal.weightKg, preference);
  if (weightTarget != null) {
    const chip = goalProgressChip({
      type: goal.type,
      metric: "weight",
      start: shownWeight(readings?.startWeightKg, preference),
      current: shownWeight(readings?.weightKg, preference),
      target: weightTarget,
      unit,
    });
    targets.push(`${weightTarget.toFixed(1)} ${unit}${chip ? ` · ${chip.text}` : ""}`);
  }
  if (goal.bodyFatPercentage != null) {
    const chip = goalProgressChip({
      type: goal.type,
      metric: "bodyFat",
      start: readings?.startBodyFatPercentage,
      current: readings?.bodyFatPercentage,
      target: goal.bodyFatPercentage,
      unit: "%",
    });
    targets.push(`${goal.bodyFatPercentage.toFixed(1)}%${chip ? ` · ${chip.text}` : ""}`);
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">Your goal</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{goal.name}</p>
      {type && <p className="text-xs text-muted-foreground">{type}</p>}
      {targets.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {targets.map((line) => (
            <p key={line} className="font-mono-display text-xs text-foreground">
              {line}
            </p>
          ))}
        </div>
      )}
      {goal.deadline && (
        <p className="mt-1 text-xs text-muted-foreground">
          {goal.type === "event_prep" ? "Event day" : "By"} {formatBlockDate(goal.deadline)}
        </p>
      )}
      {goal.description && (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {goal.description}
        </p>
      )}
    </div>
  );
}
