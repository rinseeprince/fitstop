"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ExercisePicker } from "./exercise-picker";
import { MONO_LABEL_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "./builder-tokens";

// The catalog picker, hung off the Exercises rail's "+" instead of sitting
// permanently at the bottom of the list. One affordance rather than two, and
// the list is no longer pushed down by a search field nobody is using.
//
// The picker keeps its multi-add flow inside here: picking does not close the
// popover, and the input re-focuses, so a coach can type-enter-type-enter their
// way through a session exactly as before.
type AddExercisePopoverProps = {
  onPick: (pick: { name: string; exerciseId: string | null }) => void;
};

export function AddExercisePopover({ onPick }: AddExercisePopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add exercise"
          title="Add exercise"
          className={cn(
            "rounded p-1 transition-colors hover:text-[#0d9488] data-[state=open]:text-[#0d9488]",
            TEXT_MUTED,
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
        // The picker manages its own focus (it re-focuses the input after every
        // pick); letting Radix grab it on open would fight that.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3.5 pb-2 pt-3">
          <div className={cn("text-sm font-semibold", TEXT_PRIMARY)}>
            Add exercise
          </div>
          <div className={cn("mt-0.5", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
            Search your catalogue
          </div>
        </div>
        <div className="px-3.5 pb-3">
          <ExercisePicker onPick={onPick} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
