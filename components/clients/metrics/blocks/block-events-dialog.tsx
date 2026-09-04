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

// The offer a coach gets after moving a block's dates: bring the calendar with
// it, or leave it alone. A DIALOG rather than a toast — it carries a choice and
// a follow-up question, and a toast that times out leaves a coach unsure whether
// anything happened. It says the real days it will touch, not "extend?".
//
// Nothing here is a default. Dismissing it leaves every event exactly where it
// is, which is what keeps "a block edit writes nothing on its own" true.

export type BlockEventsPrompt = {
  blockId: string;
  blockName: string;
  direction: "extended" | "shortened";
  /** The days that just joined or left the block, in the coach's own words. */
  rangeLabel: string;
};

type BlockEventsDialogProps = {
  prompt: BlockEventsPrompt | null;
  isWorking: boolean;
  onDismiss: () => void;
  onClear: () => void;
  onFill: (nutrition: "keep" | "regenerate") => void;
};

export function BlockEventsDialog({
  prompt,
  isWorking,
  onDismiss,
  onClear,
  onFill,
}: BlockEventsDialogProps) {
  if (!prompt) return null;
  const extended = prompt.direction === "extended";

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {extended ? "Fill the new days?" : "Clear the days that left?"}
          </DialogTitle>
          <DialogDescription>
            {extended
              ? `"${prompt.blockName}" now runs to ${prompt.rangeLabel}. Training and nutrition still stop where they did.`
              : `"${prompt.blockName}" now ends ${prompt.rangeLabel}. The workouts and targets after it are still on the calendar.`}
          </DialogDescription>
        </DialogHeader>

        {extended ? (
          // Two ways to price the new days, and the difference is the whole
          // question: someone eight weeks into a cut has moved, so their
          // maintenance has too.
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={isWorking}
              onClick={() => onFill("keep")}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              Keep the current targets
            </Button>
            <Button
              variant="outline"
              disabled={isWorking}
              onClick={() => onFill("regenerate")}
            >
              Recalculate from their current weight
            </Button>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss} disabled={isWorking}>
            Leave the calendar alone
          </Button>
          {!extended && (
            <Button
              variant="outline"
              className="border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
              onClick={onClear}
              disabled={isWorking}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              Clear those days
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
