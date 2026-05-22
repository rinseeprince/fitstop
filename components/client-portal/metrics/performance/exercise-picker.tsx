"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExerciseListItem } from "@/types/training";

type ExercisePickerProps = {
  exercises: ExerciseListItem[] | undefined;
  isLoading: boolean;
  selectedExerciseId: string | null;
  selectedExerciseName: string | null;
  onSelect: (exercise: ExerciseListItem) => void;
};

// Light-themed exercise picker for the client metrics hub. Mirrors the coach
// ExerciseSearchSelect structure (Popover + cmdk) but on the portal's light
// surface rather than the coach tab's dark cards.
export function ExercisePicker({
  exercises,
  isLoading,
  selectedExerciseId,
  selectedExerciseName,
  onSelect,
}: ExercisePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedFromList = exercises?.find(
    (ex) =>
      (selectedExerciseId && ex.exerciseId === selectedExerciseId) ||
      (!selectedExerciseId &&
        selectedExerciseName &&
        ex.name.toLowerCase() === selectedExerciseName.toLowerCase()),
  );
  const displayName = selectedFromList?.name ?? selectedExerciseName ?? null;
  const logCount = selectedFromList?.logCount ?? null;

  if (isLoading) {
    return <Skeleton className="h-[62px] w-full rounded-[6px]" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-[6px] border border-[rgba(13,148,136,0.1)] bg-white px-5 py-[18px] text-left transition-colors hover:bg-[#f4f7f6]"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]">
              Exercise
            </p>
            <p
              className={cn(
                "mt-0.5 truncate text-[15px] font-medium",
                displayName ? "text-[#0c1a1e]" : "text-[#93b0b4]",
              )}
            >
              {displayName ?? "Select exercise..."}
            </p>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-2">
            {logCount != null && (
              <span className="rounded-full bg-[rgba(13,148,136,0.08)] px-2 py-0.5 text-[11px] font-medium text-[#5a7d82]">
                {logCount} {logCount === 1 ? "log" : "logs"}
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-[#93b0b4]" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search exercises..." />
          <CommandList>
            <CommandEmpty>No exercises found.</CommandEmpty>
            <CommandGroup>
              {exercises?.map((ex) => {
                const isSelected =
                  (selectedExerciseId && ex.exerciseId === selectedExerciseId) ||
                  (!selectedExerciseId &&
                    displayName?.toLowerCase() === ex.name.toLowerCase());

                return (
                  <CommandItem
                    key={ex.exerciseId ?? ex.name}
                    value={ex.name}
                    onSelect={() => {
                      onSelect(ex);
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="truncate">{ex.name}</span>
                      <span className="ml-2 shrink-0 text-[11px] text-[#93b0b4]">
                        {ex.logCount} {ex.logCount === 1 ? "log" : "logs"}
                      </span>
                    </div>
                    {isSelected && (
                      <Check className="ml-2 h-4 w-4 shrink-0 text-[#0d9488]" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
