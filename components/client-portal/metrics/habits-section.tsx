"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { TEXT_SECONDARY, TRAINING_CARD_BORDER } from "@/components/clients/training/program-builder/builder-tokens";
import { HabitsLoadError } from "@/components/client-portal/habits/habits-load-error";
import { cn } from "@/lib/utils";
import { HabitProgressCard } from "./habit-progress-card";
import type { ClientHabitProgress } from "@/types/habits";

interface HabitsSectionProps {
  /** Each habit a version covered over the Journey's span, from the server; null until the read settles. */
  progress: ClientHabitProgress | null;
  /** The read failed with nothing to show. */
  error: unknown;
  onRetry: () => void;
  /** A read asked for by Try again is out. */
  retrying?: boolean;
}

/**
 * The client's habits on the Journey: one card per habit, every figure the
 * habit kernel's, on the client's calendar. The heading stands in every state;
 * under it, while the read is in flight, skeletons hold the cards' places at a
 * card's height; a failed read says so with a retry; a read that settled with
 * no habit says that — never one for the other.
 */
export function HabitsSection({ progress, error, onRetry, retrying = false }: HabitsSectionProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">My Habits</h2>
      {progress ? (
        progress.habits.length === 0 ? (
          <div className={cn("rounded-[6px] bg-white px-4 py-6", TRAINING_CARD_BORDER)}>
            <p className={cn("text-[13px]", TEXT_SECONDARY)}>No habits yet</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {progress.habits.map((row) => (
              <HabitProgressCard key={row.habit.id} row={row} />
            ))}
          </div>
        )
      ) : error ? (
        <HabitsLoadError onRetry={onRetry} retrying={retrying} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
          <Skeleton className="h-[156px] w-full rounded-[6px]" />
          <Skeleton className="h-[156px] w-full rounded-[6px]" />
        </div>
      )}
    </div>
  );
}
