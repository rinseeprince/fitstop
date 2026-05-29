"use client";

import { Check } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { DailyHabit } from "@/types/daily-habit";

interface HabitToggleRowProps {
  habit: DailyHabit;
  /** Whether this habit is recorded as completed for the selected date. */
  completed: boolean;
  /** A write for this habit is in flight. */
  isSaving: boolean;
  /** Per-row lock: this habit is already recorded on a past day (display-only). */
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}

/**
 * Presentational habit row for the client-portal habits page (controlled — "props down,
 * callbacks up" per CONVENTIONS). Owned by client-portal rather than reused from
 * `components/daily-pulse/`, which Session 5.1 deletes.
 */
export function HabitToggleRow({
  habit,
  completed,
  isSaving,
  disabled,
  onToggle,
}: HabitToggleRowProps) {
  const isDisabled = isSaving || disabled;

  return (
    <div className={`flex items-center justify-between ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <Label htmlFor={`habit-${habit.id}`} className="text-sm font-normal">
          {habit.name}
          {habit.targetValue ? (
            <span className="text-muted-foreground">
              {" · "}
              {habit.targetValue} {habit.targetUnit || ""}
            </span>
          ) : null}
        </Label>
        {completed ? <Check className="h-4 w-4 text-success" /> : null}
      </div>
      <Switch
        id={`habit-${habit.id}`}
        checked={completed}
        onCheckedChange={onToggle}
        disabled={isDisabled}
      />
    </div>
  );
}
