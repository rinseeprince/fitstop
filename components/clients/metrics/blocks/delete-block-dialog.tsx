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
// ONE line for the second CTA, saying the only thing the buttons do not: that
// the plans go too, and that the scope is THIS block. Both deletes are bounded
// by the block's window, so a later block keeps its own program and targets.
//
// What the buttons already say is not repeated: "Delete block" needs no gloss.
// A confirm that has to be read twice is not a confirm.

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

/** Which button is working, so the spinner lands on the one that was pressed. */
export type BlockDeleteChoice = "block" | "plans";

type DeleteBlockDialogProps = {
  block: ClientBlockView | null; // null = closed
  deleting: BlockDeleteChoice | null;
  onCancel: () => void;
  onConfirm: (block: ClientBlockView, clearPlans: boolean) => void;
};

export function DeleteBlockDialog({
  block,
  deleting,
  onCancel,
  onConfirm,
}: DeleteBlockDialogProps) {
  const isDeleting = deleting !== null;
  return (
    <Dialog
      open={block != null}
      onOpenChange={(open) => !open && !isDeleting && onCancel()}
    >
      {/* Deliberately NOT sm:max-w-md. DialogContent is a GRID, and a grid
          item's default `min-width: auto` means the column cannot shrink below
          its content's min-content width — three non-shrinking buttons in a row
          exceeded 448px, widened the column past the panel, and the panel's
          background then clipped everything in it, the paragraph included.
          `min-w-0` on both is what actually forbids that; the default width and
          the wrapping footer are what stop it looking cramped. */}
      <DialogContent className="min-w-0">
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
          removes the training and nutrition plans set up in this block, and
          their upcoming days. Other blocks keep theirs.
        </p>
        <DialogFooter className="min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !block}
            onClick={() => block && onConfirm(block, false)}
          >
            {deleting === "block" && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Delete block
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !block}
            onClick={() => block && onConfirm(block, true)}
          >
            {deleting === "plans" && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Delete block and its plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
