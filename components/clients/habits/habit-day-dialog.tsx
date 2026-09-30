"use client";

import { useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatDateOnlyShort, SHORT_WEEKDAY, weekdayOf } from "@/lib/date-helpers";
import { parseHabitAmount } from "@/lib/habits/habit-amount";
import { directionLabel } from "@/lib/habits/habit-words";
import { MONO_INPUT_CLASS, THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit, HabitDayFacts } from "@/types/habits";

/** What "This day" is about: one habit on one day, as the tracker showed it. */
export type HabitDaySubject = { habit: CoachHabit; day: HabitDayFacts };

/**
 * "This day": one day of a set-days habit, from the client's today on —
 * planned or not, a per-day on/off and so a Switch (docs/newdesignsystem.md →
 * Switch: "not planned" names no mode of its own), and a planned number
 * habit's target that day (empty: its days' own) — and Reset, on a day
 * already changed, to put it back to what the habit's days say. A day set
 * back to what its days say keeps no change. A save lands its answer and
 * closes the card in the same tick; a refusal leaves it open, its reason in a
 * toast. The host keys the card by its opening, so each open starts from the
 * day as it stands.
 */
export function HabitDayDialog({
  open,
  subject,
  writes,
  onOpenChange,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. */
  subject: HabitDaySubject;
  writes: HabitWrites;
  onOpenChange: (open: boolean) => void;
}) {
  const { habit, day } = subject;
  const counted = habit.measure === "number";
  const [planned, setPlanned] = useState(day.planned);
  const [target, setTarget] = useState(day.target === null ? "" : String(day.target));
  const [pending, setPending] = useState<"save" | "reset" | null>(null);
  const dayName = `${SHORT_WEEKDAY[weekdayOf(day.date)]} ${formatDateOnlyShort(day.date)}`;

  const save = async () => {
    let dayTarget: number | null = null;
    if (counted && planned && target.trim() !== "") {
      const parsed = parseHabitAmount(target);
      if ("error" in parsed) {
        toast.error("Could not save the day", { description: parsed.error });
        return;
      }
      dayTarget = parsed.value;
    }
    setPending("save");
    try {
      const answer = await writes.setDay(habit.id, day.date, { planned, target: dayTarget });
      writes.land(answer);
      onOpenChange(false);
      if (answer.changed) toast.success("Day saved");
      else toast("Nothing changed");
    } catch (error) {
      toast.error("Could not save the day", { description: error instanceof Error ? error.message : "Something went wrong" });
      setPending(null);
    }
  };

  const reset = async () => {
    setPending("reset");
    try {
      const answer = await writes.resetDay(habit.id, day.date);
      writes.land(answer);
      onOpenChange(false);
      toast.success("Day reset");
    } catch (error) {
      toast.error("Could not reset the day", { description: error instanceof Error ? error.message : "Something went wrong" });
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => pending === null && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <CalendarDays className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <div className="min-w-0">
              <DialogTitle>This day</DialogTitle>
              <DialogDescription>
                {habit.name} on {dayName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[#0c1a1e]">Planned</span>
            <Switch aria-label="Planned" checked={planned} onCheckedChange={setPlanned} disabled={pending !== null} />
          </div>
          {counted && planned && (
            <div className="space-y-1.5">
              <Label htmlFor="habit-day-target">{directionLabel(habit.direction)}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="habit-day-target"
                  inputMode="decimal"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className={cn(MONO_INPUT_CLASS, "h-8 w-24")}
                  disabled={pending !== null}
                />
                {habit.unit && <span className="text-[13px] text-[#5a7d82]">{habit.unit}</span>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {day.edited ? (
            <Button variant="ghost" onClick={() => void reset()} disabled={pending !== null}>
              {pending === "reset" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Reset
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending !== null}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={pending !== null} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
              {pending === "save" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
