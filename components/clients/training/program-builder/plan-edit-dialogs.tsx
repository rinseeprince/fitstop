"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// The plan editor's save dialogs, on the styled Dialog primitive (never
// ConfirmDialog — un-migrated OKLCH): the confirm, and the refusal a save
// meets when the calendar changed since the editor opened.

export function PlanEditConfirmDialog({
  open,
  onOpenChange,
  isSaving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      // Block dismissal while the save is in flight.
      onOpenChange={(next) => {
        if (!isSaving) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.08)]">
              <CalendarClock className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
            </div>
            <DialogTitle>Confirm updated plan</DialogTitle>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            onClick={onConfirm}
            disabled={isSaving}
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlanEditStaleDialog({
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
