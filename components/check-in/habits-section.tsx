"use client";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import type { HabitBreakdown } from "@/types/coach-overview";

type HabitsSectionProps = {
  /**
   * One entry per ACTIVE habit, from the server. Built from the habit list, not
   * from the logs: `logHabit` writes a row only when the client acts, so a
   * logs-derived grid dropped a habit ignored all week — the one a coach most
   * needs to see. That habit now reads 0/7 instead of vanishing.
   */
  perHabit: HabitBreakdown[];
};

export const HabitsSection = ({ perHabit }: HabitsSectionProps) => {
  // A habit that was never eligible in this period (created after it ended)
  // says nothing about the week and is not a miss.
  const habits = perHabit.filter((habit) => habit.eligibleDays > 0);
  if (habits.length === 0) return null;

  return (
    <div>
      <SectionLabel label="Habits" />
      {/* A grid rather than a wrapping row: five habits of differing name
          lengths wrapped into ragged runs with nothing lining up, and a habit
          readout is read down the counts and the dot rails. */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-[6px] bg-white p-5 sm:grid-cols-2 xl:grid-cols-3">
        {habits.map((habit) => (
          <div key={habit.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0c1a1e]">
              {habit.name}
            </span>
            <span className={cn("shrink-0 text-xs font-semibold", MONO, "text-[#0d9488]")}>
              {habit.completedDays}/{habit.eligibleDays}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              {habit.rail.map((day, i) =>
                // Before the habit existed: a dash, not an empty dot. A habit
                // added on Wednesday has not missed Monday, and an unfilled dot
                // would say it had.
                day === null ? (
                  <span
                    key={i}
                    className="w-2 h-px bg-[rgba(13,148,136,0.25)]"
                    title="Not yet added"
                  />
                ) : (
                  <span
                    key={i}
                    className={`w-2 h-2 rounded-full ${
                      day ? "bg-[#0d9488]" : "bg-[rgba(13,148,136,0.12)]"
                    }`}
                  />
                )
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
