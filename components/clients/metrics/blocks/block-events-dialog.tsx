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

// The question a coach answers when they save a block whose dates moved.
//
// It opens INSTEAD of the save, not after it: every choice here completes the
// save, and the X abandons it, so a coach never ends up with dates stored and a
// question they walked away from. A dialog rather than a toast because it
// carries a choice, and it names the real dates rather than asking "extend?".
//
// Nothing here is a default. "Just the dates" stores the window and leaves every
// event exactly where it is, which is what keeps "a block edit writes nothing on
// its own" true.

export type BlockEventsPrompt = {
  blockName: string;
  direction: "extended" | "shortened";
  /** The block's new last day, in the coach's own words. */
  newEndLabel: string;
  /** Where the calendar stops today — the end the block had before this edit. */
  previousEndLabel: string;
};

/** What the coach picked. Every arm saves the dates; they differ in the calendar. */
export type BlockEventsChoice =
  | { calendar: "fill"; nutrition: "keep" | "regenerate" }
  | { calendar: "clear" }
  | { calendar: "none" };

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
  const extended = prompt.direction === "extended";

  return (
    <Dialog open onOpenChange={(open) => !open && !isWorking && onCancel()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {extended ? "Carry the plan on?" : "Clear the days that left?"}
          </DialogTitle>
          <DialogDescription>
            {extended
              ? `"${prompt.blockName}" now runs to ${prompt.newEndLabel}, but the workouts and targets stop on ${prompt.previousEndLabel}.`
              : `"${prompt.blockName}" now ends ${prompt.newEndLabel}, but there are still workouts and targets scheduled after it.`}
          </DialogDescription>
        </DialogHeader>

        {extended ? (
          <div className="flex flex-col gap-2">
            {/* Both buttons continue the TRAINING. Saying so is the point: the
                difference between them is the NUTRITION, and copy that named
                only the buttons hid that a coach eight weeks into a cut is
                choosing whether their client's targets move. */}
            <p className="text-xs text-[#5a7d82]">
              The workouts carry on either way — the choice is the targets.
            </p>
            <Button
              variant="outline"
              disabled={isWorking}
              onClick={() => onChoose({ calendar: "fill", nutrition: "keep" })}
            >
              {isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Keep the same targets
            </Button>
            <Button
              variant="outline"
              disabled={isWorking}
              onClick={() =>
                onChoose({ calendar: "fill", nutrition: "regenerate" })
              }
            >
              Recalculate the targets
            </Button>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onChoose({ calendar: "none" })}
            disabled={isWorking}
          >
            Just the dates
          </Button>
          {!extended && (
            <Button
              variant="outline"
              className={DANGER_CTA}
              onClick={() => onChoose({ calendar: "clear" })}
              disabled={isWorking}
            >
              {isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Clear those days
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
