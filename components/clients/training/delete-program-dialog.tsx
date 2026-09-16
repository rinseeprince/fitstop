"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDateOnlyShort } from "@/lib/date-helpers";

/** A program in the Plans hero, as its delete asks about it. */
export type ProgramDeleteTarget = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  /** Its start is before the deletion floor: it ends rather than being removed. */
  hasStarted: boolean;
  /** The floor — the first day whose sessions the delete removes. */
  sessionsFrom: "today" | "tomorrow";
};

type DeleteProgramDialogProps = {
  open: boolean;
  /** Kept through the close, so the card fades out naming the program it asked about. */
  target: ProgramDeleteTarget | null;
  onCancel: () => void;
  /** Deletes the program. Resolves true once the caller is closing the dialog,
   *  false to keep it open as the retry. */
  onConfirm: () => Promise<boolean>;
};

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

/** A running program ends; one that hasn't started is removed. */
function describeDelete(target: ProgramDeleteTarget) {
  const name = <span className="font-semibold text-[#0c1a1e]">{target.name}</span>;
  return target.hasStarted
    ? {
        title: "End plan?",
        body: (
          <>
            Ends {name}. Its sessions from {target.sessionsFrom} onwards are removed.
          </>
        ),
        cta: "End plan",
      }
    : {
        title: "Remove plan?",
        body: (
          <>
            Removes {name}, {formatDateOnlyShort(target.startsOn)} – {formatDateOnlyShort(target.endsOn)}.
          </>
        ),
        cta: "Remove plan",
      };
}

/**
 * The Plans hero's per-program delete, in the design system's destructive
 * confirm: a danger thumb with Trash2, one plain-sans sentence naming what
 * happens, ghost Cancel and a danger-outline button that repeats the verb.
 *
 * The button spins, and the dialog can't be closed, while the delete runs. On
 * success the caller closes it once the Training tab has refetched, and the
 * spinner stays through the fade (the caller keys the dialog per open, so the
 * next one starts idle); a failure clears the spinner and leaves the dialog
 * open as the retry.
 */
export function DeleteProgramDialog({ open, target, onCancel, onConfirm }: DeleteProgramDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const copy = target ? describeDelete(target) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isDeleting) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {copy && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
                  <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
                </div>
                <DialogTitle>{copy.title}</DialogTitle>
              </div>
              <DialogDescription className="pt-2">{copy.body}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className={DANGER_CTA}
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  const closing = await onConfirm();
                  if (!closing) setIsDeleting(false);
                }}
              >
                {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {copy.cta}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
