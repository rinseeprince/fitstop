"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// The question a coach answers when they save a block whose end moved EARLIER.
//
// It opens INSTEAD of the save, not after it: every path through it completes
// the save, and the X abandons it, so a coach never ends up with dates stored
// and a question they walked away from.
//
// Only a shorter end reaches it. A block's end never moves later — the form
// caps its Ends field at the stored end and the chain PUT refuses a later one —
// so the one question is what happens to the days that left: clear them, or
// keep the dates only.

export type BlockEventsPrompt = {
  blockName: string;
  /** The block's new last day, in the coach's own words. */
  newEndLabel: string;
};

/** What the coach picked. Both arms save the dates; they differ in the calendar. */
export type BlockEventsChoice = { calendar: "clear" } | { calendar: "none" };

type BlockEventsDialogProps = {
  prompt: BlockEventsPrompt | null;
  isWorking: boolean;
  /** The X, Escape, or a click outside — nothing is saved. */
  onCancel: () => void;
  onChoose: (choice: BlockEventsChoice) => void;
};

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

export function BlockEventsDialog({
  prompt,
  isWorking,
  onCancel,
  onChoose,
}: BlockEventsDialogProps) {
  if (!prompt) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && !isWorking && onCancel()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Clear the days that left?</DialogTitle>
          <DialogDescription>
            {`"${prompt.blockName}" now ends ${prompt.newEndLabel}, but there are still workouts and targets scheduled after it.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onChoose({ calendar: "none" })}
            disabled={isWorking}
          >
            Just the dates
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            onClick={() => onChoose({ calendar: "clear" })}
            disabled={isWorking}
          >
            {isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Clear those days
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
