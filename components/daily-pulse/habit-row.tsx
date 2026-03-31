"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check } from "lucide-react";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

interface HabitRowProps {
  habit: DailyHabit;
  log: HabitLogWithDetails | undefined;
  isSaving: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}

export function HabitRow({
  habit,
  log,
  isSaving,
  disabled,
  onToggle
}: HabitRowProps) {
  const isDisabled = isSaving || disabled;

  return (
    <div className={`flex items-center justify-between ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <Label htmlFor={`habit-${habit.id}`} className="text-sm font-normal">
          {habit.name}
          {habit.targetValue && (
            <span className="text-muted-foreground">
              {' · '}{habit.targetValue} {habit.targetUnit || ''}
            </span>
          )}
        </Label>
        {log?.completed && <Check className="h-4 w-4 text-success" />}
      </div>
      <Switch
        id={`habit-${habit.id}`}
        checked={log?.completed || false}
        onCheckedChange={onToggle}
        disabled={isDisabled}
      />
    </div>
  );
}