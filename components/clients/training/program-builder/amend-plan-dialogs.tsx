"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// The placed-plan save dialogs, on the styled Dialog primitive (never
// ConfirmDialog — un-migrated OKLCH). The confirm carries the moved-events
// warning (decision 6: an amendment re-lays manually-moved future sessions);
// the drift dialog is the 409 fork — reload-and-discard vs keep editing.

type FutureModifiedEvent = { id: string; date: string; sessionName: string };

const MAX_LISTED_EVENTS = 6;

export function AmendConfirmDialog({
  open,
  onOpenChange,
  clientName,
  futureModifiedEvents,
  isAmending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string | null;
  futureModifiedEvents: FutureModifiedEvent[];
  isAmending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      // Block dismissal while the save is in flight.
      onOpenChange={(next) => {
        if (!isAmending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.08)]">
              <CalendarClock className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
            </div>
            <DialogTitle>Save changes to this plan?</DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-[#5a7d82]">
            Upcoming sessions on{" "}
            <span className="font-semibold text-[#0c1a1e]">
              {clientName ?? "your client"}
            </span>
            &apos;s calendar will be updated and re-dated to match this program.
            Days that already happened are untouched.
          </p>
          {futureModifiedEvents.length > 0 && (
            <div className="rounded-[6px] bg-[rgba(245,158,11,0.07)] p-3">
              <p className="text-[12px] font-medium text-[#d97706]">
                {futureModifiedEvents.length === 1
                  ? "1 manually-moved upcoming session"
                  : `${futureModifiedEvents.length} manually-moved upcoming sessions`}{" "}
                will be re-laid onto the program schedule:
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {futureModifiedEvents.slice(0, MAX_LISTED_EVENTS).map((event) => (
                  <li key={event.id} className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono-display text-[11px] text-[#d97706]">
                      {format(new Date(event.date + "T00:00:00"), "EEE, MMM d")}
                    </span>
                    <span className="min-w-0 truncate text-[12px] text-[#5a7d82]">
                      {event.sessionName}
                    </span>
                  </li>
                ))}
                {futureModifiedEvents.length > MAX_LISTED_EVENTS && (
                  <li className="font-mono-display text-[11px] text-[#d97706]">
                    +{futureModifiedEvents.length - MAX_LISTED_EVENTS} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isAmending}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            onClick={onConfirm}
            disabled={isAmending}
          >
            {isAmending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AmendDriftDialog({
  open,
  onOpenChange,
  onReload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const [isReloading, setIsReloading] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isReloading) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This plan changed while you were editing</DialogTitle>
        </DialogHeader>
        <p className="py-1 text-sm text-[#5a7d82]">
          The client&apos;s calendar moved since you opened the editor — a new day
          started, or something on the calendar changed. Reload the plan to
          continue from the latest state, or keep editing to copy your changes
          somewhere first.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isReloading}>
            Keep editing
          </Button>
          <Button
            variant="outline"
            className="border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
            disabled={isReloading}
            onClick={async () => {
              setIsReloading(true);
              try {
                await onReload();
              } finally {
                setIsReloading(false);
              }
            }}
          >
            {isReloading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Reload and discard edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
