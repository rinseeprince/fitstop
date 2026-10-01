"use client";

import { Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HABIT_HOW_TO_MAX } from "@/lib/constants";
import { directionLabel } from "@/lib/habits/habit-words";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { HabitScheduleFields } from "./habit-schedule-fields";
import type { ChoiceDraft } from "./add-habits-draft";
import type { HabitChoice } from "@/types/habits";

/** Days, then target, as every habit line reads. */
const choiceLine = (choice: HabitChoice) =>
  [choice.words.schedule, choice.words.target].filter((part): part is string => part !== null).join(" · ");

/**
 * One of the coach's habits in the Add habits sheet: its name and, under it,
 * its days then its target, the whole row one toggle (`role="checkbox"`, the
 * builder's picking idiom: a row picked as one, not a tick box beside it).
 * Picked, it opens its how-to, days and target to adjust for this client.
 */
export function HabitChoiceRow({
  choice,
  idPrefix,
  draft,
  onToggle,
  onChange,
  disabled,
}: {
  choice: HabitChoice;
  idPrefix: string;
  /** The habit as it will be added; null while it is not picked. */
  draft: ChoiceDraft | null;
  onToggle: () => void;
  onChange: (draft: ChoiceDraft) => void;
  disabled: boolean;
}) {
  const picked = draft !== null;
  return (
    <div className={cn("rounded-[6px] bg-white", picked && "ring-1 ring-inset ring-[#0d9488]")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        onClick={onToggle}
        disabled={disabled}
        className={cn("flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left disabled:cursor-not-allowed", FOCUS_RING)}
      >
        <span
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border",
            picked ? "border-[#0d9488] bg-[#0d9488]" : "border-[rgba(13,148,136,0.25)] bg-white"
          )}
        >
          {picked && <Check className="h-3 w-3 text-white" strokeWidth={2.5} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[#0c1a1e]">{choice.name}</span>
          <span className="mt-0.5 block truncate text-xs text-[#5a7d82]">{choiceLine(choice)}</span>
        </span>
      </button>

      {draft && (
        <div className="space-y-3 border-t border-[rgba(13,148,136,0.06)] px-3 pb-3 pt-3">
          <HabitScheduleFields
            idPrefix={idPrefix}
            counted={choice.measure === "number"}
            targetLabel={directionLabel(choice.direction)}
            unit={choice.unit}
            draft={draft.schedule}
            onChange={(schedule) => onChange({ ...draft, schedule })}
            disabled={disabled}
          />
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-how-to`}>How to (optional)</Label>
            <Textarea
              id={`${idPrefix}-how-to`}
              value={draft.howTo}
              maxLength={HABIT_HOW_TO_MAX}
              onChange={(event) => onChange({ ...draft, howTo: event.target.value })}
              rows={2}
              className="resize-none bg-white"
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
