"use client";

import { format } from "date-fns";
import { CopyPlus, Loader2, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TrainingEvent } from "@/types/training";

// Styled confirms for the calendar's destructive actions (deletes + the
// replacing duplicate). Danger styling stays on the documented pair —
// #c06060 text + rgba(192,96,96,0.08) washes — there is no filled
// destructive button in the design system.
const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

function DangerThumb({ icon: Icon = Trash2 }: { icon?: LucideIcon }) {
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
      <Icon className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
    </div>
  );
}

function formatDay(date: string): string {
  return format(new Date(date + "T00:00:00"), "EEE, MMM d");
}

type DeleteEventDialogProps = {
  event: TrainingEvent | null; // null = closed
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (event: TrainingEvent) => void;
};

export function DeleteEventDialog({
  event,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteEventDialogProps) {
  return (
    <Dialog open={event != null} onOpenChange={(open) => !open && !isDeleting && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DangerThumb />
            <DialogTitle>Remove session?</DialogTitle>
          </div>
        </DialogHeader>
        {event && (
          <p className="text-sm text-[#5a7d82]">
            Removes <span className="font-semibold text-[#0c1a1e]">{event.sessionName}</span> on{" "}
            {formatDay(event.date)} from the calendar.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDeleting || !event}
            onClick={() => event && onConfirm(event)}
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Remove session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type DuplicateWeekMode = "next" | "remaining";

type DuplicateWeekConfirmDialogProps = {
  /** null = closed. */
  pending: { weekStartDate: string; mode: DuplicateWeekMode } | null;
  isDuplicating: boolean;
  onCancel: () => void;
  onConfirm: (weekStartDate: string, mode: DuplicateWeekMode) => void;
};

export function DuplicateWeekConfirmDialog({
  pending,
  isDuplicating,
  onCancel,
  onConfirm,
}: DuplicateWeekConfirmDialogProps) {
  const isNext = pending?.mode === "next";
  return (
    <Dialog
      open={pending != null}
      onOpenChange={(open) => !open && !isDuplicating && onCancel()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DangerThumb icon={CopyPlus} />
            <DialogTitle>
              {isNext ? "Duplicate to next week?" : "Duplicate to all remaining weeks?"}
            </DialogTitle>
          </div>
        </DialogHeader>
        {pending && (
          <p className="text-sm text-[#5a7d82]">
            Copies the week of {formatDay(pending.weekStartDate)} onto{" "}
            {isNext ? "next week" : "every remaining week of this plan"}, replacing
            any upcoming sessions already scheduled there.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isDuplicating}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isDuplicating || !pending}
            onClick={() => pending && onConfirm(pending.weekStartDate, pending.mode)}
          >
            {isDuplicating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isNext ? "Duplicate week" : "Duplicate weeks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ClearWeekDialogProps = {
  weekStartDate: string | null; // null = closed
  isClearing: boolean;
  onCancel: () => void;
  onConfirm: (weekStartDate: string) => void;
};

export function ClearWeekDialog({
  weekStartDate,
  isClearing,
  onCancel,
  onConfirm,
}: ClearWeekDialogProps) {
  return (
    <Dialog
      open={weekStartDate != null}
      onOpenChange={(open) => !open && !isClearing && onCancel()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DangerThumb />
            <DialogTitle>Clear this week?</DialogTitle>
          </div>
        </DialogHeader>
        {weekStartDate && (
          <p className="text-sm text-[#5a7d82]">
            Removes the upcoming scheduled sessions from the week of{" "}
            {formatDay(weekStartDate)}.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isClearing}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isClearing || !weekStartDate}
            onClick={() => weekStartDate && onConfirm(weekStartDate)}
          >
            {isClearing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Clear week
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
