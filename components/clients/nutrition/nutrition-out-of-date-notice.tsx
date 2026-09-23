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
 * a saved version no longer fits the goal on its days. It says so and offers
 * the way to fix it — Regenerate when the problem starts today, "Set nutrition
 * from <day>" when a later goal takes over — and never regenerates anything
 * itself. Every word is a sentence, so all sans (the prose rule), numbers
 * included.
 */
type NutritionOutOfDateNoticeProps = {
  outOfDate: NutritionOutOfDate;
  /** The client's today — decides "today" against "from 19 Oct". */
  clientToday: string;
  /** Today's problem: opens the drawer from today. Omitted in the drawer,
   *  whose own button is the regenerate. */
  onRegenerate?: () => void;
  /** Starts the drawer on the notice's day. */
  onSetFrom?: (day: string) => void;
};

/** A goal as the calculator priced it, in the coach's own unit. */
function describe(pricing: GoalPricing, viewer: UnitSystem): string {
  if (pricing.goalWeightKg == null) return "Maintenance";
  // A goal weight, so formatWeight — converts freely, never snaps.
  const { value, unit } = formatWeight(pricing.goalWeightKg, viewer);
  const weight = `${value.toFixed(1)} ${unit}`;
  return pricing.deadline
    ? `${weight} by ${formatDateOnlyShort(pricing.deadline)}`
    : `${weight}, no deadline`;
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

  const action =
    fromToday && onRegenerate
      ? { label: "Regenerate", run: onRegenerate }
      : onSetFrom
        ? { label: `Set nutrition from ${day}`, run: () => onSetFrom(outOfDate.fromDay) }
        : null;

  return (
    <div className="flex items-start gap-2.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] p-3.5">
      <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d97706]" strokeWidth={1.5} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[11.5px] font-medium leading-[1.4] text-[#d97706]">
          {fromToday
            ? "Goal changed since these targets were built."
            : `The targets from ${day} weren't built for that day's goal.`}
        </p>
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          {describe(outOfDate.built, preference)} → {describe(outOfDate.goal, preference)}
        </p>
      </div>
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
