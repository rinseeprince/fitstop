"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { cn } from "@/lib/utils";
import { HABIT_HOW_TO_MAX, HABIT_NAME_MAX, HABIT_UNIT_MAX } from "@/lib/constants";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { isHabitDirection } from "@/lib/habits/habit-entry";
import { HabitScheduleFields } from "./habit-schedule-fields";
import type { NewHabitDraft } from "./add-habits-draft";

const DIRECTIONS = [
  { value: "at_least", label: "At least" },
  { value: "at_most", label: "At most" },
];

/**
 * A new habit in the Add habits sheet: its name, whether it is ticked or
 * counted — a number with its unit and which side of its target it wants, at
 * least (water, steps, sleep) or at most (drinks, screen time) — its days and
 * target, and its how-to, which the client sees.
 */
export function NewHabitCard({
  draft,
  onChange,
  onRemove,
  disabled,
}: {
  draft: NewHabitDraft;
  onChange: (draft: NewHabitDraft) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const id = `new-habit-${draft.key}`;
  const counted = draft.measure === "number";
  return (
    <div className="space-y-3 rounded-[6px] bg-white p-3 ring-1 ring-inset ring-[#0d9488]">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            placeholder="e.g. Drink water"
            value={draft.name}
            maxLength={HABIT_NAME_MAX}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="h-8"
            disabled={disabled}
          />
        </div>
        <button
          type="button"
          aria-label="Remove new habit"
          onClick={onRemove}
          disabled={disabled}
          className={cn("mb-1 rounded p-1 text-[#93b0b4] transition-colors hover:text-[#c06060] disabled:opacity-50", FOCUS_RING)}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-[#0c1a1e]">Track a number</span>
        <Switch
          aria-label="Track a number"
          checked={counted}
          onCheckedChange={(on) => onChange({ ...draft, measure: on ? "number" : "tick" })}
          disabled={disabled}
        />
      </div>

      {counted && (
        <SegmentedControl
          options={DIRECTIONS.map((option) => ({ ...option, disabled }))}
          value={draft.direction}
          onChange={(value) => {
            if (isHabitDirection(value)) onChange({ ...draft, direction: value });
          }}
          fullWidth
        />
      )}

      <HabitScheduleFields
        idPrefix={id}
        counted={counted}
        targetLabel="Target"
        unit={null}
        unitSlot={
          <Input
            aria-label="Unit"
            placeholder="Unit, e.g. L"
            value={draft.unit}
            maxLength={HABIT_UNIT_MAX}
            onChange={(event) => onChange({ ...draft, unit: event.target.value })}
            className="h-8 w-32"
            disabled={disabled}
          />
        }
        draft={draft.schedule}
        onChange={(schedule) => onChange({ ...draft, schedule })}
        disabled={disabled}
      />

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-how-to`}>How to (optional)</Label>
        <Textarea
          id={`${id}-how-to`}
          placeholder="What the client sees, e.g. A glass with each meal"
          value={draft.howTo}
          maxLength={HABIT_HOW_TO_MAX}
          onChange={(event) => onChange({ ...draft, howTo: event.target.value })}
          rows={2}
          className="resize-none"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
