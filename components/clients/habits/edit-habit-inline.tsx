"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { versionOn } from "@/lib/habits/habit-day";
import { HABIT_HOW_TO_MAX, HABIT_NAME_MAX } from "@/lib/constants";
import { parseHabitAmount } from "@/lib/habits/habit-amount";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit, CoachHabitList } from "@/types/habits";

/**
 * Why the form is open: `edit`, the habit's labels and a running number
 * habit's target; `start-again`, a stopped number habit with no version left
 * (stopped on its first day), which has no target to start again with.
 */
export type HabitEditMode = "edit" | "start-again";

type EditHabitInlineProps = {
  habit: CoachHabit;
  /** The client's today: a new target runs from it. */
  clientToday: string;
  mode: HabitEditMode;
  writes: HabitWrites;
  onClose: () => void;
};

/** What a rename saved, in words: the name, the how-to, or both. */
function savedLabels(nameChanged: boolean, howToChanged: boolean): string {
  if (nameChanged && howToChanged) return "The name and how-to are saved.";
  return nameChanged ? "The name is saved." : "The how-to is saved.";
}

/**
 * A habit's labels — its name and its how-to, on any habit — and, for a number
 * habit running today, its target, which changes from the client's today:
 * the days before keep the target they had. Opened to start a stopped number
 * habit again with no version left, the Target box starts empty and must be
 * filled: saving starts the habit again every day from today with that target.
 * How the habit is measured, and its unit, never change. Only what changed is
 * written: the labels, then the target — a retyped "3.0" over a 3 is no
 * change. A write that saved without the habits read back is still saved: its
 * null answer is landed as any other. A refusal leaves the form open with its
 * reason; should the target's write fail after the labels saved, the form
 * stays open and says which labels are saved.
 */
export const EditHabitInline = ({ habit, clientToday, mode, writes, onClose }: EditHabitInlineProps) => {
  const startingAgain = mode === "start-again";
  const running = versionOn(habit, clientToday);
  const targetSeed = habit.measure === "number" && running?.target != null ? String(running.target) : null;

  const [name, setName] = useState(habit.name);
  const [howTo, setHowTo] = useState(habit.howTo ?? "");
  const [target, setTarget] = useState(targetSeed ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const failed = startingAgain ? "Could not start the habit again" : "Could not save the habit";
    const nextName = name.trim();
    const nextHowTo = howTo.trim() || null;
    if (!nextName) {
      toast.error(failed, { description: "Enter a name" });
      return;
    }
    const nameChanged = nextName !== habit.name;
    const howToChanged = nextHowTo !== habit.howTo;
    // Starting again needs a target. Otherwise an untouched box writes nothing,
    // and the number decides whether a touched one changed.
    let nextTarget: number | null = null;
    if (startingAgain || (targetSeed !== null && target !== targetSeed)) {
      const parsed = parseHabitAmount(target);
      if ("error" in parsed) {
        toast.error(failed, { description: parsed.error });
        return;
      }
      if (startingAgain || parsed.value !== running?.target) nextTarget = parsed.value;
    }
    if (!nameChanged && !howToChanged && nextTarget === null) {
      onClose();
      return;
    }

    setIsSaving(true);
    let renamed = false;
    let answer: CoachHabitList | null = null;
    try {
      if (nameChanged || howToChanged) {
        answer = (await writes.rename(habit.id, nextName, nextHowTo)).habits;
        renamed = true;
      }
      if (nextTarget !== null) {
        answer = (
          await writes.change(habit.id, {
            target: nextTarget,
            // Starting again runs every day; a new target keeps the running version's days.
            ...(!running
              ? { weekdays: [...DAYS_OF_WEEK] }
              : running.timesPerWeek !== null
                ? { timesPerWeek: running.timesPerWeek }
                : { weekdays: running.weekdays }),
          })
        ).habits;
      }
      writes.land(answer);
      onClose();
      if (startingAgain) toast.success(`"${nextName}" started again`, { description: "It runs from today." });
      else toast.success(`"${nextName}" updated`, nextTarget !== null ? { description: "The new target runs from today." } : undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Something went wrong";
      if (renamed) {
        // The labels saved; the target's write did not.
        writes.land(answer);
        const unsaved = startingAgain ? "It did not start again" : "The target is not";
        toast.error("Partly saved", { description: `${savedLabels(nameChanged, howToChanged)} ${unsaved}: ${reason}` });
      } else {
        toast.error(failed, { description: reason });
      }
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") void handleSave();
    else if (event.key === "Escape") onClose();
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
      <div className="flex-1 space-y-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Habit name"
          aria-label="Habit name"
          maxLength={HABIT_NAME_MAX}
          className="h-8 text-sm"
          autoFocus={!startingAgain}
          disabled={isSaving}
        />
        <Input
          value={howTo}
          onChange={(event) => setHowTo(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="How to (optional)"
          aria-label="How to"
          maxLength={HABIT_HOW_TO_MAX}
          className="h-8 text-sm"
          disabled={isSaving}
        />
        {(startingAgain || targetSeed !== null) && (
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Target"
              aria-label="Target"
              required={startingAgain}
              autoFocus={startingAgain}
              className="h-8 w-24 text-sm"
              disabled={isSaving}
            />
            {habit.unit && <span className="text-xs text-muted-foreground">{habit.unit}</span>}
          </div>
        )}
      </div>

      <div className="flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => void handleSave()}
          disabled={isSaving}
          aria-label="Save habit"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} disabled={isSaving} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
