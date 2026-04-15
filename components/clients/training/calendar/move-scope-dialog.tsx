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
          <label className="flex items-center gap-2 p-2 rounded-[6px] border border-[rgba(13,148,136,0.08)] cursor-pointer hover:bg-[rgba(13,148,136,0.03)] transition-colors">
            <input
              type="radio"
              name="move-scope"
              value="single"
              checked={scope === "single"}
              onChange={() => setScope("single")}
              className="accent-teal-600"
            />
            <span className="text-sm text-[#0c1a1e]">Just this date</span>
          </label>

          <label className="flex items-center gap-2 p-2 rounded-[6px] border border-[rgba(13,148,136,0.08)] cursor-pointer hover:bg-[rgba(13,148,136,0.03)] transition-colors">
            <input
              type="radio"
              name="move-scope"
              value="all_future"
              checked={scope === "all_future"}
              onChange={() => setScope("all_future")}
              className="accent-teal-600"
            />
            <span className="text-sm text-[#0c1a1e]">
              This and all future {event.sessionName} sessions
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={() => onConfirm(scope)} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
