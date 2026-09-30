"use client";

import { useState } from "react";
import { CirclePause, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { CoachHabit } from "@/types/habits";

/** What the confirm is about: stopping a habit from today, or deleting one the client never logged. */
export type HabitConfirmSubject = { kind: "stop" | "delete"; habit: CoachHabit };

const COPY = {
  stop: {
    title: (name: string) => `Stop ${name}?`,
    body: "It stops from today. Its past stays.",
    action: "Stop habit",
    failed: "Could not stop the habit",
  },
  delete: {
    title: (name: string) => `Delete ${name}?`,
    body: "Removes it and its schedule for good; the client never logged it.",
    action: "Delete habit",
    failed: "Delete failed",
  },
} as const;

/**
 * The confirm behind a habit's Stop and Delete (docs/newdesignsystem.md →
 * Destructive confirm dialog). Delete is the destructive recipe, its
 * danger-outline CTA; Stop is not destructive — a stopped habit can be
 * started again — so it takes the non-destructive confirm's teal thumb and
 * teal primary (the plan editor's, `move-plan-dialog.tsx`). The host writes,
 * lands the answer and closes this; a refusal
 * leaves it open, its reason in a toast. The pending flag outlives the close,
 * so the closing card keeps its spinner, and the host keys the card by its
 * opening so the next one starts fresh.
 */
export function HabitConfirmDialog({
  open,
  subject,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. Null only before the first open. */
  subject: HabitConfirmSubject | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: HabitConfirmSubject) => Promise<void>;
}) {
  const [isPending, setIsPending] = useState(false);
  const copy = COPY[subject?.kind ?? "stop"];
  const destructive = subject?.kind === "delete";

  const handleConfirm = async () => {
    if (!subject) return;
    setIsPending(true);
    try {
      await onConfirm(subject);
    } catch (error) {
      toast.error(copy.failed, {
        description: error instanceof Error ? error.message : "Something went wrong",
      });
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-[6px]",
                destructive ? "bg-[rgba(192,96,96,0.08)]" : THUMB_CLASS
              )}
            >
              {destructive ? (
                <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
              ) : (
                <CirclePause className="h-4 w-4" strokeWidth={1.5} />
              )}
            </span>
            <DialogTitle>{subject ? copy.title(subject.habit.name) : copy.action}</DialogTitle>
          </div>
        </DialogHeader>

        <p className="text-sm text-[#5a7d82]">{copy.body}</p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "outline" : undefined}
            onClick={() => void handleConfirm()}
            disabled={isPending || !subject}
            className={
              destructive
                ? "border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
                : "bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            }
          >
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
