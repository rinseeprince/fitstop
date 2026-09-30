"use client";

import { HabitProgressCard } from "./habit-progress-card";
import type { HabitProgressRow } from "@/types/habits";

interface HabitsSectionProps {
  /** Each habit a version covered over the Journey's span: its recent weeks and its last days, from the server. */
  habits: HabitProgressRow[];
}

/** The client's habits on the Journey: one card per habit, every figure the habit kernel's, on the client's calendar. */
export function HabitsSection({ habits }: HabitsSectionProps) {
  if (habits.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">My Habits</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {habits.map((row) => (
          <HabitProgressCard key={row.habit.id} row={row} />
        ))}
      </div>
    </div>
  );
}
