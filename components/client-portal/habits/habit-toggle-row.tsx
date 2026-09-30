"use client";

import { Check } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ClientHabitDayItem } from "@/types/habits";

interface HabitToggleRowProps {
  /** A tick habit on the day: its entry says done or not. */
  item: ClientHabitDayItem;
  /** A write for this habit is in flight. */
  isSaving: boolean;
  /** The day is locked: the row is display-only. */
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}

/**
 * A tick habit's row on the client-portal habits page (controlled — "props
 * down, callbacks up" per CONVENTIONS): its name, a check when the day is
 * done, and the switch.
 */
export function HabitToggleRow({ item, isSaving, disabled, onToggle }: HabitToggleRowProps) {
  const { habit, day } = item;
  const checked = day.entry?.done === true;

  return (
    <div className={`flex items-center justify-between ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <Label htmlFor={`habit-${habit.id}`} className="text-sm font-normal">
          {habit.name}
        </Label>
        {day.met ? <Check className="h-4 w-4 text-success" aria-label="Done" /> : null}
      </div>
      <Switch
        id={`habit-${habit.id}`}
        checked={checked}
        onCheckedChange={onToggle}
        disabled={isSaving || disabled}
      />
    </div>
  );
}
