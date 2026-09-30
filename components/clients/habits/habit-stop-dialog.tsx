"use client";

import { useState } from "react";
import { CirclePause, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateOnlyShort, isCalendarDay } from "@/lib/date-helpers";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { HabitDayField } from "./habit-schedule-fields";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit } from "@/types/habits";

/** The day a stop runs from, in the sentence that says so. */
export const fromWords = (day: string, clientToday: string) => (day === clientToday ? "today" : formatDateOnlyShort(day));

/**
 * Stop, from a day — the plan editor's teal confirm (`move-plan-dialog.tsx`;
 * docs/newdesignsystem.md → Date picker popover → Behaviour), not the
 * destructive recipe, since a stopped habit starts again: the day it stops
 * from, today unless the coach picks a later one, and one sentence saying what
 * happens. The save lands its answer and closes the card in the same tick; a
 * stop that changed nothing — the habit already stops before that day — says
 * so; a refusal leaves the card open, its reason in a toast. The pending flag
 * outlives the close, so the closing card keeps its spinner, and the host keys
 * the card by its opening so the next one starts fresh.
 */
export function HabitStopDialog({
  open,
  habit,
  clientToday,
  writes,
  onOpenChange,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. */
  habit: CoachHabit;
  clientToday: string;
  writes: HabitWrites;
  onOpenChange: (open: boolean) => void;
}) {
  const [stopsOn, setStopsOn] = useState(clientToday);
  const [isPending, setIsPending] = useState(false);

  const stop = async () => {
    if (!isCalendarDay(stopsOn) || stopsOn < clientToday) {
      toast.error("Could not stop the habit", { description: "Pick today or a later day to stop from." });
      return;
    }
    setIsPending(true);
    try {
      const answer = await writes.stop(habit.id, stopsOn === clientToday ? undefined : stopsOn);
      writes.land(answer);
      onOpenChange(false);
      if (answer.changed) toast.success(`"${habit.name}" stopped`, { description: "Its past stays." });
      else toast("Nothing changed");
    } catch (error) {
      toast.error("Could not stop the habit", { description: error instanceof Error ? error.message : "Something went wrong" });
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <CirclePause className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>Stop {habit.name}?</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <HabitDayField
            id="habit-stop-from"
            label="From"
            value={stopsOn}
            clientToday={clientToday}
            onChange={setStopsOn}
            disabled={isPending}
          />
          <p className="text-sm text-[#5a7d82]">
            {isCalendarDay(stopsOn) ? `It stops from ${fromWords(stopsOn, clientToday)}. Its past stays.` : "Its past stays."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => void stop()} disabled={isPending} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Stop habit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
