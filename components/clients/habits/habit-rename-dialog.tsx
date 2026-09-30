"use client";

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HABIT_HOW_TO_MAX, HABIT_NAME_MAX } from "@/lib/constants";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit } from "@/types/habits";

/**
 * Rename: a habit's labels — its name and its how-to, which the client sees —
 * on any habit, running, starting later or stopped. How it is measured never
 * changes. A form left as it was writes nothing; a save lands its answer and
 * closes the card in the same tick; a refusal leaves it open, its reason in a
 * toast. The host keys the card by its opening, so each open starts from the
 * habit as it stands.
 */
export function HabitRenameDialog({
  open,
  habit,
  writes,
  onOpenChange,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. */
  habit: CoachHabit;
  writes: HabitWrites;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(habit.name);
  const [howTo, setHowTo] = useState(habit.howTo ?? "");
  const [isPending, setIsPending] = useState(false);

  const save = async () => {
    const nextName = name.trim();
    const nextHowTo = howTo.trim() || null;
    if (!nextName) {
      toast.error("Could not save the habit", { description: "Enter a name" });
      return;
    }
    if (nextName === habit.name && nextHowTo === habit.howTo) {
      onOpenChange(false);
      return;
    }
    setIsPending(true);
    try {
      const answer = await writes.rename(habit.id, nextName, nextHowTo);
      writes.land(answer);
      onOpenChange(false);
      if (answer.changed) toast.success(`"${nextName}" updated`);
      else toast("Nothing changed");
    } catch (error) {
      toast.error("Could not save the habit", { description: error instanceof Error ? error.message : "Something went wrong" });
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <Pencil className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>Rename {habit.name}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="habit-rename-name">Name</Label>
            <Input
              id="habit-rename-name"
              value={name}
              maxLength={HABIT_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              className="h-8"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="habit-rename-how-to">How to (optional)</Label>
            <Textarea
              id="habit-rename-how-to"
              placeholder="What the client sees, e.g. A glass with each meal"
              value={howTo}
              maxLength={HABIT_HOW_TO_MAX}
              onChange={(event) => setHowTo(event.target.value)}
              rows={2}
              className="resize-none"
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isPending} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
