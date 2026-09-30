"use client";

import { History } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { habitHistoryLines } from "./habit-history";
import type { CoachHabit } from "@/types/habits";

/**
 * History: a habit's versions in words, oldest first — each run of days with
 * its days and target, and the day it stopped where nothing ran straight
 * after (`habitHistoryLines`). A readout: nothing on it writes.
 */
export function HabitHistoryDialog({
  open,
  habit,
  clientToday,
  onOpenChange,
}: {
  open: boolean;
  /** Outlives the close: Radix re-renders a closing card from live props. */
  habit: CoachHabit;
  clientToday: string;
  onOpenChange: (open: boolean) => void;
}) {
  const lines = habitHistoryLines(habit, clientToday);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn(THUMB_CLASS, "h-9 w-9")}>
              <History className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <DialogTitle>{habit.name} history</DialogTitle>
          </div>
        </DialogHeader>
        {/* Each line weaves days and numbers into words: sans throughout. */}
        <ol className="divide-y divide-[rgba(13,148,136,0.06)] py-1">
          {lines.map((line, i) => (
            <li key={i} className="py-2 text-sm text-[#0c1a1e]">
              {line}
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
