"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { TrainingEvent } from "@/types/training";

type MoveScopeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: TrainingEvent;
  sourceDate: string;
  targetDate: string;
  onConfirm: (scope: "single" | "all_future") => void;
  isLoading: boolean;
};

export function MoveScopeDialog({
  open,
  onOpenChange,
  event,
  sourceDate,
  targetDate,
  onConfirm,
  isLoading,
}: MoveScopeDialogProps) {
  const [scope, setScope] = useState<"single" | "all_future">("single");

  const formattedSource = format(new Date(sourceDate + "T00:00:00"), "EEE, MMM d");
  const formattedTarget = format(new Date(targetDate + "T00:00:00"), "EEE, MMM d");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {event.sessionName}?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-[#5a7d82]">
          From {formattedSource} to {formattedTarget}
        </p>

        <div className="space-y-2 py-2">
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[6px] border p-2 transition-colors",
              scope === "single"
                ? "border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)]"
                : "border-[rgba(13,148,136,0.08)] hover:bg-[rgba(13,148,136,0.03)]"
            )}
          >
            <input
              type="radio"
              name="move-scope"
              value="single"
              checked={scope === "single"}
              onChange={() => setScope("single")}
              className="accent-[#0d9488]"
            />
            <span className="text-sm text-[#0c1a1e]">Just this date</span>
          </label>

          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[6px] border p-2 transition-colors",
              scope === "all_future"
                ? "border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)]"
                : "border-[rgba(13,148,136,0.08)] hover:bg-[rgba(13,148,136,0.03)]"
            )}
          >
            <input
              type="radio"
              name="move-scope"
              value="all_future"
              checked={scope === "all_future"}
              onChange={() => setScope("all_future")}
              className="accent-[#0d9488]"
            />
            <span className="text-sm text-[#0c1a1e]">
              This and all future {event.sessionName} sessions
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            onClick={() => onConfirm(scope)}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
