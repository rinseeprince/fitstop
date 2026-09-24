"use client";

import { Target, X } from "lucide-react";
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
 * and what the calories still aim for — or, for calories the coach typed,
 * which aim for nothing, when the goal changed and to check them (commit
 * 8d4) — and a button offers the fix: Regenerate when the problem starts
 * today, "Set nutrition from <day>" when a later goal takes over. It never
 * regenerates anything itself. Prose, so all sans (the prose rule), numbers
 * included.
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
  /** The ×: closes the notice everywhere until the goal changes again. */
  onClose?: () => void;
};

/** A goal weight in the coach's own unit — formatWeight converts freely, never snaps. */
function weightText(kg: number, viewer: UnitSystem): string {
  const { value, unit } = formatWeight(kg, viewer);
  return `${value.toFixed(1)} ${unit}`;
}

/** What the saved calories were worked out for — the Journey's goals table says it the same way. */
export function describeBuilt(pricing: GoalPricing, viewer: UnitSystem): string {
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

/**
 * Calories the coach typed were priced for no goal, so they are never said to
 * aim for one: the notice says when the goal changed — undated when the change
 * carries no day — and asks for a check.
 */
function handTypedSentence(outOfDate: NutritionOutOfDate, clientToday: string): string {
  const changedOn = outOfDate.goalChangedOn;
  let when: string;
  if (outOfDate.goalName === null) {
    when =
      outOfDate.fromDay === clientToday
        ? "There's no goal now."
        : `From ${formatDateOnlyShort(outOfDate.fromDay)} there's no goal.`;
  } else if (changedOn === null) {
    when = "The goal has changed.";
  } else if (changedOn <= clientToday) {
    when = `The goal changed on ${formatDateOnlyShort(changedOn)}.`;
  } else {
    when = `From ${formatDateOnlyShort(changedOn)} the goal changes.`;
  }
  return `${when} These calories were set by hand — check they still fit.`;
}

export function NutritionOutOfDateNotice({
  outOfDate,
  clientToday,
  onRegenerate,
  onSetFrom,
  onClose,
}: NutritionOutOfDateNoticeProps) {
  const { preference } = useUnits();
  const fromToday = outOfDate.fromDay === clientToday;
  const day = formatDateOnlyShort(outOfDate.fromDay);
  const built = describeBuilt(outOfDate.built, preference);
  const goal =
    outOfDate.goalName == null ? null : describeGoal(outOfDate.goalName, outOfDate.goal, preference);

  let sentence: string;
  if (outOfDate.setByHand) {
    sentence = handTypedSentence(outOfDate, clientToday);
  } else if (fromToday) {
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
      {onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(
            FOCUS_RING,
            "shrink-0 rounded-[4px] p-0.5 text-[#93b0b4] transition-colors hover:text-[#5a7d82]"
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
