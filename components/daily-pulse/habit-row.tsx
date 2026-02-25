"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  onBooleanToggle: (checked: boolean) => void;
  onNumericChange: (value: number | undefined) => void;
  onNumericBlur: (value: number | undefined) => void;
}

export function HabitRow({ 
  habit, 
  log, 
  isSaving, 
  onBooleanToggle, 
  onNumericChange,
  onNumericBlur 
}: HabitRowProps) {
  const getNumericFeedbackColor = (value: number | undefined, target: number | undefined) => {
    if (!value || !target) return "";
    const percentage = (value / target) * 100;
    if (percentage >= 100) return "text-green-600";
    if (percentage >= 80) return "text-amber-600";
    return "text-red-600";
  };

  if (habit.isBoolean) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor={`habit-${habit.id}`} className="text-sm font-normal">
            {habit.name}
          </Label>
          {log?.completed && <Check className="h-4 w-4 text-green-600" />}
        </div>
        <Switch
          id={`habit-${habit.id}`}
          checked={log?.completed || false}
          onCheckedChange={onBooleanToggle}
          disabled={isSaving}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={`habit-${habit.id}`} className="text-sm">
        {habit.name}
        {habit.targetValue && (
          <span className="text-muted-foreground ml-2">
            Target: {habit.targetValue} {habit.targetUnit || ""}
          </span>
        )}
      </Label>
      <Input
        id={`habit-${habit.id}`}
        type="number"
        placeholder="0"
        value={log?.value ?? ""}
        onChange={(e) => {
          const value = e.target.value ? parseFloat(e.target.value) : undefined;
          onNumericChange(value);
        }}
        onBlur={(e) => {
          const value = e.target.value ? parseFloat(e.target.value) : undefined;
          onNumericBlur(value);
        }}
        disabled={isSaving}
        className={getNumericFeedbackColor(log?.value, habit.targetValue)}
      />
    </div>
  );
}