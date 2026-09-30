"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import { HABIT_HOW_TO_MAX, HABIT_NAME_MAX, HABIT_UNIT_MAX } from "@/lib/constants";
import { parseHabitAmount } from "@/lib/habits/habit-amount";
import type { NewHabit } from "@/hooks/use-client-habits";
import type { HabitDirection } from "@/types/habits";

type AddHabitInlineFormProps = {
  /** Adds the habit; the host lands the answer and closes the form. A refusal throws its reason. */
  onSubmit: (habit: NewHabit) => Promise<void>;
  onCancel: () => void;
};

const DIRECTIONS: { value: HabitDirection; label: string }[] = [
  { value: "at_least", label: "At least" },
  { value: "at_most", label: "At most" },
];

/**
 * A new habit, every day from the client's today: its name, its how-to (shown
 * to the client), and whether it is ticked or counted — a number with its
 * target, its unit and which side of the target it wants: at least (water,
 * steps, sleep) or at most (drinks, screen time).
 */
export function AddHabitInlineForm({ onSubmit, onCancel }: AddHabitInlineFormProps) {
  const [name, setName] = useState("");
  const [howTo, setHowTo] = useState("");
  const [isNumeric, setIsNumeric] = useState(false);
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [direction, setDirection] = useState<HabitDirection>("at_least");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    let targetValue: number | null = null;
    if (isNumeric) {
      const parsed = parseHabitAmount(target);
      if ("error" in parsed) {
        toast.error("Could not add the habit", { description: parsed.error });
        return;
      }
      targetValue = parsed.value;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        howTo: howTo.trim() || null,
        measure: isNumeric ? "number" : "tick",
        unit: isNumeric && unit.trim() ? unit.trim() : null,
        direction: isNumeric ? direction : null,
        target: targetValue,
        weekdays: [...DAYS_OF_WEEK],
      });
    } catch (error) {
      toast.error("Could not add the habit", {
        description: error instanceof Error ? error.message : "Something went wrong",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4 space-y-3 bg-[#f4f7f6]">
      <div className="space-y-1.5">
        <Label htmlFor="inline-name" className="text-[11px] text-[#5a7d82]">Name</Label>
        <Input
          id="inline-name"
          placeholder="e.g., Drink water"
          maxLength={HABIT_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-white"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inline-how-to" className="text-[11px] text-[#5a7d82]">How to (optional)</Label>
        <Textarea
          id="inline-how-to"
          placeholder="What the client sees, e.g. A glass with each meal"
          maxLength={HABIT_HOW_TO_MAX}
          value={howTo}
          onChange={(e) => setHowTo(e.target.value)}
          rows={2}
          className="resize-none bg-white"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="inline-numeric" className="text-[11px] text-[#5a7d82]">Track a number</Label>
        <Switch id="inline-numeric" checked={isNumeric} onCheckedChange={setIsNumeric} />
      </div>

      {isNumeric && (
        <>
          <SegmentedControl
            options={DIRECTIONS}
            value={direction}
            onChange={(value) => setDirection(value as HabitDirection)}
            fullWidth
          />
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="inline-target" className="text-[11px] text-[#5a7d82]">Target</Label>
              <Input
                id="inline-target"
                inputMode="decimal"
                placeholder="e.g., 3"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="inline-unit" className="text-[11px] text-[#5a7d82]">Unit</Label>
              <Input
                id="inline-unit"
                placeholder="e.g., L"
                maxLength={HABIT_UNIT_MAX}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="bg-white"
              />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
          className="border-[rgba(13,148,136,0.08)] text-[#5a7d82] text-[12px]"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={!name.trim() || isSubmitting}
          className="bg-[#0d9488] hover:bg-[#0f766e] text-white text-[12px]"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Add Habit
        </Button>
      </div>
    </div>
  );
}
