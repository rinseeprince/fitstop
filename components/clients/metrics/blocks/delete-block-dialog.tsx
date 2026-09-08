"use client";

import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

// Destructive confirm per the design system's recipe (the delete-event-dialog
// silhouette): styled Dialog — never AlertDialog — danger thumb, ghost Cancel +
// danger-OUTLINE CTA repeating the verb. There is no filled destructive button
// in this system.
//
// Two CTAs, because the plans are a separate decision and neither answer is a
// default. Deleting the block alone leaves the calendar untouched — a block owns
// its own window (migration 164), so the row goes and nothing else moves.
//
// ONE consequence sentence, for the second CTA only. It fires the two plan
// deletes the calendars already offer, and those run from today FORWARD with no
// upper bound — so a later block's program goes with them, and a coach who is
// not told that finds out by losing work.
//
// What the buttons already say is not repeated: "Delete block" needs no gloss,
// and "upcoming" carries the past-is-safe half without a sentence of its own.
// A confirm that has to be read twice is not a confirm.

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

type DeleteBlockDialogProps = {
  block: ClientBlockView | null; // null = closed
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (block: ClientBlockView, clearPlans: boolean) => void;
};

export function DeleteBlockDialog({
  block,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteBlockDialogProps) {
  return (
    <Dialog
      open={block != null}
      onOpenChange={(open) => !open && !isDeleting && onCancel()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </div>
            <DialogTitle>
              Delete{" "}
              <span className="font-semibold text-[#0c1a1e]">
                {block?.name}
              </span>
              ?
            </DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-[#5a7d82]">
          <span className="font-semibold text-[#0c1a1e]">
            Delete block and its plans
          </span>{" "}
          removes their training and nutrition plans too — every upcoming day of
          both goes, including days in later blocks.
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !block}
            onClick={() => block && onConfirm(block, false)}
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete block
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !block}
            onClick={() => block && onConfirm(block, true)}
          >
            Delete block and its plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
