"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dateStringToDayNumber } from "@/lib/date-helpers";
import { formatDateOnlyWeekday } from "@/components/clients/overview/overview-format";

/** The move a coach picked from the calendar, as the confirm asks about it. */
export type PlanMoveChoice = {
  programName: string;
  /** The program's start as the calendar showed it. */
  fromDate: string;
  /** The day picked. */
  toDate: string;
};

type MovePlanDialogProps = {
  open: boolean;
  /** Kept through the close, so the card fades out showing the move it asked about. */
  choice: PlanMoveChoice | null;
  onCancel: () => void;
  /** Moves the program. The caller closes the dialog once the move and its refresh are done. */
  onConfirm: () => Promise<void>;
};

/** "It will start on Fri, 18 Sept, and every session moves 2 days later with it." */
function describeMove({ fromDate, toDate }: PlanMoveChoice): string {
  const shift = dateStringToDayNumber(toDate) - dateStringToDayNumber(fromDate);
  const days = Math.abs(shift);
  return `It will start on ${formatDateOnlyWeekday(toDate)}, and every session moves ${days} ${
    days === 1 ? "day" : "days"
  } ${shift > 0 ? "later" : "earlier"} with it.`;
}

/**
 * The confirm between picking a day and moving the program (owner, 2026-09-16).
 *
 * Move program spins, and the dialog can't be closed, until the move and the
 * Training tab's refetch are done; the caller then closes it, so the screen it
 * fades out onto already shows the new dates. The spinner is never cleared
 * here: it stays through the fade, and the caller keys the dialog per open, so
 * the next one starts idle.
 */
export function MovePlanDialog({ open, choice, onCancel, onConfirm }: MovePlanDialogProps) {
  const [isMoving, setIsMoving] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isMoving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {choice && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.08)]">
                  <CalendarClock className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
                </div>
                <DialogTitle>Move {choice.programName}?</DialogTitle>
              </div>
              <DialogDescription className="pt-2">{describeMove(choice)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onCancel} disabled={isMoving}>
                Cancel
              </Button>
              <Button
                className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
                disabled={isMoving}
                onClick={() => {
                  setIsMoving(true);
                  void onConfirm();
                }}
              >
                {isMoving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Move program
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
