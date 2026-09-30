"use client";

import { useState } from "react";
import { Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isCalendarDay } from "@/lib/date-helpers";
import { versionOn } from "@/lib/habits/habit-day";
import { directionLabel } from "@/lib/habits/habit-words";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { draftFromVersion, readScheduleDraft } from "./habit-schedule-draft";
import { HabitDayField, HabitScheduleFields } from "./habit-schedule-fields";
import { fromWords } from "./habit-stop-dialog";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit, HabitVersion } from "@/types/habits";

/** Why the dialog is open: a running or starting-later habit's change, or a stopped habit started again. */
type HabitScheduleMode = "change" | "start-again";

/**
 * The day the dialog opens on, and the version its fields are seeded from. A
 * change: from today with the version running today; for a habit starting
 * later, from its first day with that version — a change from today would
 * start it today. Starting again: from today, with its last target and days
 * (none left when it stopped on its first day: every day, the Target box
 * empty).
 */
function opening(habit: CoachHabit, mode: HabitScheduleMode, clientToday: string): { from: string; version: HabitVersion | null } {
  if (mode === "start-again") return { from: clientToday, version: habit.versions[habit.versions.length - 1] ?? null };
  const running = versionOn(habit, clientToday);
  if (running) return { from: clientToday, version: running };
  const next = habit.versions.find((version) => version.startsOn > clientToday) ?? null;
  return { from: next?.startsOn ?? clientToday, version: next };
}

/**
 * Change target or days, and Start again: a habit's target and days from a
 * day, today or later on the client's calendar — the days before keep what
 * they had. The save lands its answer and closes the card in the same tick; a
 * refusal leaves it open, its reason in a toast. The host keys the card by
 * its opening, so each open starts from the habit as it stands.
 */
export function HabitScheduleDialog({
  open,
  habit,
  mode,
  clientToday,
  writes,
  onOpenChange,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. */
  habit: CoachHabit;
  mode: HabitScheduleMode;
  clientToday: string;
  writes: HabitWrites;
  onOpenChange: (open: boolean) => void;
}) {
  const [seed] = useState(() => opening(habit, mode, clientToday));
  const [from, setFrom] = useState(seed.from);
  const [draft, setDraft] = useState(() => draftFromVersion(seed.version));
  const [isPending, setIsPending] = useState(false);
  const startingAgain = mode === "start-again";
  const failed = startingAgain ? "Could not start the habit again" : "Could not change the habit";

  const save = async () => {
    if (!isCalendarDay(from) || from < clientToday) {
      toast.error(failed, { description: "Pick today or a later day to start from." });
      return;
    }
    const read = readScheduleDraft(habit.measure, draft);
    if ("error" in read) {
      toast.error(failed, { description: read.error });
      return;
    }
    setIsPending(true);
    try {
      const answer = await writes.change(habit.id, {
        ...(from === clientToday ? {} : { startsOn: from }),
        target: read.target,
        ...read.schedule,
      });
      writes.land(answer);
      onOpenChange(false);
      if (!answer.changed) toast("Nothing changed");
      else if (startingAgain) toast.success(`"${habit.name}" started again`, { description: `It runs from ${fromWords(from, clientToday)}.` });
      else toast.success(`"${habit.name}" changed`, { description: `The change runs from ${fromWords(from, clientToday)}.` });
    } catch (error) {
      toast.error(failed, { description: error instanceof Error ? error.message : "Something went wrong" });
      setIsPending(false);
    }
  };

  const Glyph = startingAgain ? RotateCcw : SlidersHorizontal;

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <Glyph className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>{startingAgain ? `Start ${habit.name} again` : `Change ${habit.name}`}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <HabitScheduleFields
            idPrefix="habit-schedule"
            counted={habit.measure === "number"}
            targetLabel={directionLabel(habit.direction)}
            unit={habit.unit}
            draft={draft}
            onChange={setDraft}
            disabled={isPending}
          />
          <HabitDayField id="habit-schedule-from" label="From" value={from} clientToday={clientToday} onChange={setFrom} disabled={isPending} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isPending} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {startingAgain ? "Start again" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
