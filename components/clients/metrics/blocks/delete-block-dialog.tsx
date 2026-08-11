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
// silhouette): styled Dialog — never AlertDialog — danger thumb, ONE
// plain-sans sentence naming the consequence (built by delete-block-sentence
// from the same pure helper the route executes), ghost Cancel + danger-
// OUTLINE CTA repeating the verb. There is no filled destructive button in
// this system.

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

type DeleteBlockDialogProps = {
  block: ClientBlockView | null; // null = closed
  sentence: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (block: ClientBlockView) => void;
};

export function DeleteBlockDialog({
  block,
  sentence,
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
        {sentence && <p className="text-sm text-[#5a7d82]">{sentence}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !block}
            onClick={() => block && onConfirm(block)}
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
