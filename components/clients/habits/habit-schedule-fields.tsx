"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { WeekdayToggleRow } from "@/components/programs/shared/weekday-toggle-row";
import { MONO_INPUT_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { cn } from "@/lib/utils";
import { scheduleWords } from "@/lib/habits/habit-words";
import type { DaysMode, ScheduleDraft } from "./habit-schedule-draft";

type HabitScheduleFieldsProps = {
  /** Prefixes the fields' ids, so two sets of fields on one screen never share one. */
  idPrefix: string;
  /** A number habit asks for its target; a tick habit has none. */
  counted: boolean;
  /** The words in front of the Target box: "At least", "At most", or "Target" where the direction is picked beside it. */
  targetLabel: string;
  /** The habit's unit, after the Target box; `unitSlot` in its place where the unit is still being typed. */
  unit: string | null;
  unitSlot?: ReactNode;
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  disabled?: boolean;
};

const DAYS_MODES: { value: DaysMode; label: string }[] = [
  { value: "every", label: "Every day" },
  { value: "set", label: "Chosen days" },
  { value: "weekly", label: "Times a week" },
];

const TIMES_PER_WEEK = [1, 2, 3, 4, 5, 6, 7];

const isDaysMode = (value: string): value is DaysMode => DAYS_MODES.some((mode) => mode.value === value);

/**
 * The day a habit write runs from — Starts on, From — floored on the client's
 * today: every habit date rule is judged on the client's calendar, and a day
 * before it would be refused, so it is greyed in the picker (docs/
 * newdesignsystem.md → "Date inputs express their bounds natively").
 */
export function HabitDayField({
  id,
  label,
  value,
  clientToday,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  clientToday: string;
  onChange: (day: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        min={clientToday}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-44 bg-white"
        disabled={disabled}
      />
    </div>
  );
}

/**
 * A habit's target and days, as the Add habits sheet, Change target or days
 * and Start again ask for them: a number habit's Target box with its unit;
 * every day, chosen weekdays (the weekday toggle row) or N times a week.
 */
export function HabitScheduleFields({
  idPrefix,
  counted,
  targetLabel,
  unit,
  unitSlot,
  draft,
  onChange,
  disabled = false,
}: HabitScheduleFieldsProps) {
  return (
    <div className="space-y-3">
      {counted && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-target`}>{targetLabel}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-target`}
              inputMode="decimal"
              placeholder="e.g. 3"
              value={draft.target}
              onChange={(event) => onChange({ ...draft, target: event.target.value })}
              className={cn(MONO_INPUT_CLASS, "h-8 w-24 bg-white")}
              disabled={disabled}
            />
            {unitSlot ?? (unit && <span className="text-[13px] text-[#5a7d82]">{unit}</span>)}
          </div>
        </div>
      )}

      {/* The Days label names the whole group: the switch and the days under it. */}
      <div role="group" aria-labelledby={`${idPrefix}-days`} className="space-y-1.5">
        <Label asChild>
          <p id={`${idPrefix}-days`}>Days</p>
        </Label>
        <SegmentedControl
          options={DAYS_MODES.map((mode) => ({ ...mode, disabled }))}
          value={draft.mode}
          onChange={(value) => {
            if (isDaysMode(value)) onChange({ ...draft, mode: value });
          }}
          fullWidth
        />
        {draft.mode === "set" && (
          <WeekdayToggleRow label="Chosen days" value={draft.weekdays} onChange={(weekdays) => onChange({ ...draft, weekdays })} disabled={disabled} />
        )}
        {draft.mode === "weekly" && (
          <Select
            value={String(draft.timesPerWeek)}
            onValueChange={(value) => onChange({ ...draft, timesPerWeek: Number(value) })}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Times a week" className="h-8 w-full bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMES_PER_WEEK.map((times) => (
                <SelectItem key={times} value={String(times)}>
                  {scheduleWords({ timesPerWeek: times, weekdays: [] })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
