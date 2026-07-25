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
import {
  HEADER_EYEBROW_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { ExerciseListItem } from "@/types/training";

export type ExerciseMetric =
  | "weight"
  | "e1rm"
  | "volume"
  | "rpe"
  | "compliance"
  | "prs";

// Sentence case preserves the e1RM/PRs casing (control options are sans).
export const METRIC_OPTIONS: { value: ExerciseMetric; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "e1rm", label: "e1RM" },
  { value: "volume", label: "Volume" },
  { value: "rpe", label: "RPE" },
  { value: "compliance", label: "Compliance" },
  { value: "prs", label: "PRs" },
];

type ExerciseSearchSelectProps = {
  exercises: ExerciseListItem[] | undefined;
  isLoading: boolean;
  selectedExerciseId: string | null;
  selectedExerciseName: string | null;
  onSelect: (exercise: ExerciseListItem) => void;
  metric: ExerciseMetric;
  onMetricChange: (metric: ExerciseMetric) => void;
};

// The Exercise Data hero, shaped like the Metrics hero: the eyebrow+title
// cluster is the (searchable) picker trigger, and the metric lens row sits
// under a hairline inside the same dark slab.
export function ExerciseSearchSelect({
  exercises,
  isLoading,
  selectedExerciseId,
  selectedExerciseName,
  onSelect,
  metric,
  onMetricChange,
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

  if (isLoading) {
    // 125px = the slab's rendered height (py-[18px]×2 + eyebrow/title block +
    // mt-3/pt-3 hairline + 24.5px lens row) — a shorter skeleton shifts the
    // page on load
    return <Skeleton className="h-[125px] w-full rounded-[6px] bg-[#0f2027]" />;
  }

  return (
    <div className="bg-[#0f2027] rounded-[6px] px-5 py-[18px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            role="combobox"
            aria-expanded={open}
            className="-mx-2 -my-1 flex max-w-full items-center rounded-[4px] px-2 py-1 text-left transition-colors hover:bg-[#132930] data-[state=open]:bg-[#132930]"
          >
            <div className="min-w-0">
              <p className={HEADER_EYEBROW_CLASS}>
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
            <ChevronDown className="h-4 w-4 shrink-0 ml-2 text-[rgba(255,255,255,0.3)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0 shadow-[0_10px_40px_rgba(13,148,136,0.10)]"
          align="start"
          sideOffset={6}
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
                        <span className={cn(MONO, "ml-2 shrink-0 text-[11px] text-[#93b0b4]")}>
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

      {/* Metric lens row — the hero's "underneath" slot (the Metrics hero's
          stat-band position). Active = the icon strip's on-dark active recipe. */}
      <div className="mt-3 flex items-center gap-1 border-t border-[rgba(255,255,255,0.06)] pt-3">
        {METRIC_OPTIONS.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={metric === m.value}
            onClick={() => onMetricChange(m.value)}
            className={cn(
              "rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
              metric === m.value
                ? "bg-[rgba(13,148,136,0.15)] text-[#0d9488]"
                : "text-[rgba(255,255,255,0.45)] hover:text-white",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
