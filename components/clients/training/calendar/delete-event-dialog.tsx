"use client";

import { format } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TrainingEvent } from "@/types/training";

// Styled confirms for the two calendar deletes. Danger styling stays on the
// documented pair — #c06060 text + rgba(192,96,96,0.08) washes — there is no
// filled destructive button in the design system.
const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

function DangerThumb() {
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
      <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
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
            <span className="font-mono-display">{formatDay(event.date)}</span> from the
            calendar.
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
            Removes all scheduled sessions from the week of{" "}
            <span className="font-mono-display">{formatDay(weekStartDate)}</span>.
            Completed and past sessions are kept.
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
