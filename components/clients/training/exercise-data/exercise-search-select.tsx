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
    return <Skeleton className="h-[62px] w-full rounded-[6px] bg-[#0f2027]" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="flex w-full items-center justify-between bg-[#0f2027] rounded-[6px] px-5 py-[18px] text-left hover:bg-[#132930] transition-colors"
        >
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-[rgba(255,255,255,0.35)] font-medium">
              Exercise
            </p>
            <p
              className={cn(
                "text-[15px] font-medium mt-0.5 truncate",
                displayName ? "text-white" : "text-[rgba(255,255,255,0.4)]",
              )}
            >
              {displayName ?? "Select exercise..."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {logCount != null && (
              <span className="text-[11px] font-medium text-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.12)] px-2 py-0.5 rounded-full">
                {logCount} {logCount === 1 ? "log" : "logs"}
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-[rgba(255,255,255,0.3)]" />
          </div>
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
