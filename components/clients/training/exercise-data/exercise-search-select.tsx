"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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

type ExerciseSearchSelectProps = {
  exercises: ExerciseListItem[] | undefined;
  isLoading: boolean;
  selectedExerciseId: string | null;
  selectedExerciseName: string | null;
  onSelect: (exercise: ExerciseListItem) => void;
};

export function ExerciseSearchSelect({
  exercises,
  isLoading,
  selectedExerciseId,
  selectedExerciseName,
  onSelect,
}: ExerciseSearchSelectProps) {
  const [open, setOpen] = useState(false);

  // Resolve display name: match from list if available, otherwise use URL param
  const selectedFromList = exercises?.find(
    (ex) =>
      (selectedExerciseId && ex.exerciseId === selectedExerciseId) ||
      (!selectedExerciseId &&
        selectedExerciseName &&
        ex.name.toLowerCase() === selectedExerciseName.toLowerCase()),
  );
  const displayName =
    selectedFromList?.name ?? selectedExerciseName ?? null;

  if (isLoading) {
    return <Skeleton className="h-10 w-full rounded-[6px]" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="flex w-full items-center justify-between border border-[rgba(13,148,136,0.08)] rounded-[6px] px-3 py-2 text-[13px] text-left hover:border-[rgba(13,148,136,0.2)] transition-colors"
        >
          <span
            className={cn(
              "truncate",
              displayName ? "text-[#0c1a1e]" : "text-[#93b0b4]",
            )}
          >
            {displayName ?? "Select exercise..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-[#93b0b4]" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
