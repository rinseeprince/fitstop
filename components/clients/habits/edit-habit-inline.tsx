"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import type { DailyHabit, DailyHabitInput } from "@/types/daily-habit";

type EditHabitInlineProps = {
  habit: DailyHabit;
  onSave: (data: Partial<DailyHabitInput>) => Promise<void>;
  onCancel: () => void;
};

export const EditHabitInline = ({
  habit,
  onSave,
  onCancel,
}: EditHabitInlineProps) => {
  const [name, setName] = useState(habit.name);
  const [targetValue, setTargetValue] = useState(
    habit.targetValue?.toString() || ""
  );
  const [targetUnit, setTargetUnit] = useState(habit.targetUnit || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      onCancel();
      return;
    }

    setIsSaving(true);
    try {
      const updates: Partial<DailyHabitInput> = {
        name: name.trim(),
      };

      // Only update numeric fields if this is a numeric habit
      if (!habit.isBoolean) {
        updates.targetValue = targetValue ? parseFloat(targetValue) : undefined;
        updates.targetUnit = targetUnit.trim() || undefined;
      }

      await onSave(updates);
    } catch {
      // Error handled by the parent
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
      <div className="flex-1 space-y-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Habit name"
          className="h-8 text-sm"
          autoFocus
          disabled={isSaving}
        />
        
        {!habit.isBoolean && (
          <div className="flex gap-2">
            <Input
              type="number"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Target"
              className="h-8 w-20 text-sm"
              disabled={isSaving}
            />
            <Input
              value={targetUnit}
              onChange={(e) => setTargetUnit(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Unit"
              className="h-8 flex-1 text-sm"
              disabled={isSaving}
            />
          </div>
        )}
      </div>

      <div className="flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleSave}
          disabled={isSaving}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onCancel}
          disabled={isSaving}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};