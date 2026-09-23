"use client";

import { Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { GoalPricing, NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

/**
 * The one out-of-date notice (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1),
 * shown on the Overview's nutrition card, the Nutrition tab and the drawer:
 * a saved version no longer fits the goal on its days. One sentence (the
 * owner's wording, 2026-09-23) names the goal from the day the problem starts
 * and what the calories still aim for, and a button offers the fix —
 * Regenerate when the problem starts today, "Set nutrition from <day>" when a
 * later goal takes over. It never regenerates anything itself. A sentence, so
 * all sans (the prose rule), numbers included.
 */
type NutritionOutOfDateNoticeProps = {
  outOfDate: NutritionOutOfDate;
  /** The client's today — decides "now" against "From 19 Oct". */
  clientToday: string;
  /** Today's problem: opens the drawer from today. Omitted in the drawer,
   *  whose own button is the regenerate. */
  onRegenerate?: () => void;
  /** Starts the drawer on the notice's day. */
  onSetFrom?: (day: string) => void;
};

/** A goal weight in the coach's own unit — formatWeight converts freely, never snaps. */
function weightText(kg: number, viewer: UnitSystem): string {
  const { value, unit } = formatWeight(kg, viewer);
  return `${value.toFixed(1)} ${unit}`;
}

/** What the saved calories were worked out for. */
function describeBuilt(pricing: GoalPricing, viewer: UnitSystem): string {
  if (pricing.goalWeightKg == null) return "maintenance";
  const weight = weightText(pricing.goalWeightKg, viewer);
  return pricing.deadline
    ? `${weight} by ${formatDateOnlyShort(pricing.deadline)}`
    : `${weight}, no deadline`;
}

/** The goal by its name, with the weight and deadline it has, if any. */
function describeGoal(name: string, pricing: GoalPricing, viewer: UnitSystem): string {
  if (pricing.goalWeightKg == null) return name;
  const weight = weightText(pricing.goalWeightKg, viewer);
  return pricing.deadline
    ? `${name} (${weight} by ${formatDateOnlyShort(pricing.deadline)})`
    : `${name} (${weight}, no deadline)`;
}

export function NutritionOutOfDateNotice({
  outOfDate,
  clientToday,
  onRegenerate,
  onSetFrom,
}: NutritionOutOfDateNoticeProps) {
  const { preference } = useUnits();
  const fromToday = outOfDate.fromDay === clientToday;
  const day = formatDateOnlyShort(outOfDate.fromDay);
  const built = describeBuilt(outOfDate.built, preference);
  const goal =
    outOfDate.goalName == null ? null : describeGoal(outOfDate.goalName, outOfDate.goal, preference);

  let sentence: string;
  if (fromToday) {
    sentence = goal
      ? `The goal is now ${goal}, but the calories still aim for ${built}.`
      : `There's no goal now, but the calories still aim for ${built}.`;
  } else {
    sentence = goal
      ? `From ${day} the goal is ${goal}, but the calories still aim for ${built}.`
      : `From ${day} there's no goal, but the calories still aim for ${built}.`;
  }

  const action =
    fromToday && onRegenerate
      ? { label: "Regenerate", run: onRegenerate }
      : onSetFrom
        ? { label: `Set nutrition from ${day}`, run: () => onSetFrom(outOfDate.fromDay) }
        : null;

  return (
    <div className="flex items-start gap-2.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] p-3.5">
      <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d97706]" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 text-[11.5px] font-medium leading-[1.4] text-[#d97706]">
        {sentence}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.run}
          className={cn(
            FOCUS_RING,
            "shrink-0 rounded-[4px] text-[11.5px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
          )}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
