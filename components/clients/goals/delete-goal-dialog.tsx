"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import type { GoalOnDay } from "@/types/client-goals";

/** What the confirm is about: the goal, and what takes its place. */
export type DeleteGoalSubject = {
  goal: GoalOnDay;
  /** Today's goal, rather than a planned one. */
  isCurrent: boolean;
  /** The goal a delete of today's puts back in force; null = none. */
  previousName: string | null;
};

/** The one sentence naming exactly what the delete does. */
function consequence(subject: DeleteGoalSubject, clientName: string): string {
  const { goal, isCurrent, previousName } = subject;
  if (!isCurrent) return `Deletes ${goal.name}, planned from ${formatDateOnlyShort(goal.startsOn)}.`;
  if (previousName) return `Deletes ${goal.name}. ${previousName} becomes the current goal again.`;
  return `Deletes ${goal.name}. ${clientName} will have no current goal.`;
}

/**
 * Destructive confirm for a goal (docs/newdesignsystem.md → Destructive
 * confirm dialog). The host deletes, lands the answer and closes this in one
 * tick; the pending flag outlives that close, so the closing card keeps its
 * spinner, and the host keys the card by its opening so the next one starts
 * fresh.
 */
export function DeleteGoalDialog({
  open,
  subject,
  clientName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. Null only before the first open. */
  subject: DeleteGoalSubject | null;
  clientName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: DeleteGoalSubject) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (!subject) return;
    setIsDeleting(true);
    try {
      await onConfirm(subject);
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : "Something went wrong",
      });
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isDeleting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </span>
            <DialogTitle>{subject ? `Delete ${subject.goal.name}?` : "Delete goal?"}</DialogTitle>
          </div>
        </DialogHeader>

        {subject && (
          <p className="text-sm text-[#5a7d82]">{consequence(subject, clientName)}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleConfirm()}
            disabled={isDeleting || !subject}
            className="border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
