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
// It opens INSTEAD of the save, not after it: every path through it completes
// the save, and the X abandons it, so a coach never ends up with dates stored
// and a question they walked away from.
//
// ONE QUESTION AT A TIME. Extending asks whether to carry the plans on at all,
// and only then how to price the targets. The two were previously a single row
// of buttons that both extended the training, which made the choice unaskable:
// the dialog had to say the workouts carried on either way, directly under a
// sentence saying they stopped. Nothing extends unless the coach says so.

export type BlockEventsPrompt = {
  blockName: string;
  direction: "extended" | "shortened";
  /** The block's new last day, in the coach's own words. */
  newEndLabel: string;
  /** Where the calendar stops today — the end the block had before this edit. */
  previousEndLabel: string;
};

/** Which question is on screen. The PARENT owns it, so dismissing resets it. */
export type BlockEventsStep = "ask" | "price";

/** What the coach picked. Every arm saves the dates; they differ in the calendar. */
export type BlockEventsChoice =
  | { calendar: "fill"; nutrition: "keep" | "regenerate" }
  | { calendar: "clear" }
  | { calendar: "none" };

type BlockEventsDialogProps = {
  prompt: BlockEventsPrompt | null;
  step: BlockEventsStep;
  isWorking: boolean;
  /** The X, Escape, or a click outside — nothing is saved. */
  onCancel: () => void;
  /** Step 2 → step 1, with nothing written. */
  onBack: () => void;
  /** Step 1's yes. The parent decides whether the pricing question follows. */
  onExtend: () => void;
  onChoose: (choice: BlockEventsChoice) => void;
};

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

export function BlockEventsDialog({
  prompt,
  step,
  isWorking,
  onCancel,
  onBack,
  onExtend,
  onChoose,
}: BlockEventsDialogProps) {
  if (!prompt) return null;
  const extended = prompt.direction === "extended";
  const pricing = extended && step === "price";

  return (
    <Dialog open onOpenChange={(open) => !open && !isWorking && onCancel()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {pricing
              ? "How should the new days be priced?"
              : extended
                ? "Carry the plan on?"
                : "Clear the days that left?"}
          </DialogTitle>
          <DialogDescription>
            {pricing
              ? // Says what recalculating DOES rather than asserting an outcome:
                // the training half can still decline, and today's target is the
                // thing a coach most needs to know will not move.
                "Recalculating uses their current weight and goal, and takes effect tomorrow — today's target doesn't move."
              : extended
                ? `"${prompt.blockName}" now runs to ${prompt.newEndLabel}, but the workouts and targets stop on ${prompt.previousEndLabel}.`
                : `"${prompt.blockName}" now ends ${prompt.newEndLabel}, but there are still workouts and targets scheduled after it.`}
          </DialogDescription>
        </DialogHeader>

        {pricing ? (
          <div className="flex flex-col gap-2">
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
              Recalculate
            </Button>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={pricing ? onBack : () => onChoose({ calendar: "none" })}
            disabled={isWorking}
          >
            {pricing ? "Back" : "Just the dates"}
          </Button>
          {!pricing &&
            (extended ? (
              <Button
                variant="outline"
                onClick={onExtend}
                disabled={isWorking}
              >
                {isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Extend the plans
              </Button>
            ) : (
              <Button
                variant="outline"
                className={DANGER_CTA}
                onClick={() => onChoose({ calendar: "clear" })}
                disabled={isWorking}
              >
                {isWorking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Clear those days
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
