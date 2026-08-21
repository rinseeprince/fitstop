"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Correcting a recorded START value. Not a delete, but the destructive-confirm
 * recipe is the right one (docs/newdesignsystem.md → Destructive confirm
 * dialog): it overwrites a fact nothing else can recover — no later
 * measurement can tell you where a client began — and it re-bases every
 * progress figure derived from it. The one deviation from the recipe is the
 * glyph: AlertTriangle rather than Trash2, because nothing is being removed.
 */
const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

/** "a and b" — British list; there are at most two start values. Each phrase
 *  carries its own verb ("becomes 92.0 kg", "is removed") so a change and a
 *  withdrawal read correctly in the same sentence. */
function joinEdits(edits: string[]): string {
  return edits.length <= 1 ? (edits[0] ?? "") : `${edits[0]} and ${edits[1]}`;
}

type ConfirmStartEditDialogProps = {
  open: boolean;
  /** Pre-formatted phrases, e.g. "start weight to 84.0 kg". */
  edits: string[];
  clientName: string;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmStartEditDialog({
  open,
  edits,
  clientName,
  isSaving,
  onCancel,
  onConfirm,
}: ConfirmStartEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSaving && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <AlertTriangle className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </div>
            <DialogTitle>Change the recorded start?</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-[#5a7d82]">
          <span className="font-semibold text-[#0c1a1e]">{clientName}</span>&apos;s{" "}
          {joinEdits(edits)}. Every progress figure is measured from this, so
          their totals and pace change to match.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="outline" className={DANGER_CTA} onClick={onConfirm} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Update start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
