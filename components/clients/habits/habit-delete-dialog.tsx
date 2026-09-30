"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit } from "@/types/habits";

/**
 * The confirm behind a habit's Delete (docs/newdesignsystem.md → Destructive
 * confirm dialog): one sentence for every habit, logged or not (owner, at
 * commit 3's smoke), and the danger-outline CTA. The delete lands its answer
 * and closes the card in the same tick; a refusal leaves it open, its reason
 * in a toast. The pending flag outlives the close, so the closing card keeps
 * its spinner, and the host keys the card by its opening so the next one
 * starts fresh.
 */
export function HabitDeleteDialog({
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
  const [isPending, setIsPending] = useState(false);

  const remove = async () => {
    setIsPending(true);
    try {
      const answer = await writes.remove(habit.id);
      writes.land(answer);
      onOpenChange(false);
      toast.success(`"${habit.name}" deleted`);
    } catch (error) {
      toast.error("Delete failed", { description: error instanceof Error ? error.message : "Something went wrong" });
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </span>
            <DialogTitle>Delete {habit.name}?</DialogTitle>
          </div>
        </DialogHeader>

        <p className="text-sm text-[#5a7d82]">Everything the client has logged against this habit will stay.</p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void remove()}
            disabled={isPending}
            className="border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
          >
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete habit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
