"use client";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { habitSectionRows, type HabitRailMark } from "@/lib/check-in/habit-section-rows";
import type { SentHabitWeek } from "@/lib/check-in/sent-snapshot";

type HabitsSectionProps = {
  /**
   * The habit week the check-in froze when it was sent: every habit a version
   * covered that week, the one the client ignored all week included, so it
   * reads 0 of its planned days instead of vanishing. Null for a check-in
   * whose week could not be resolved.
   */
  habitWeek: SentHabitWeek | null;
};

/** A dash's words: why the day holds nothing to judge. */
const DASH_TITLE: Partial<Record<HabitRailMark, string>> = {
  not_planned: "Not planned",
  not_yet_added: "Not yet added",
  not_running: "Not running",
};

export const HabitsSection = ({ habitWeek }: HabitsSectionProps) => {
  const habits = habitSectionRows(habitWeek);
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
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#0c1a1e]">
              {habit.name}
            </span>
            <span className={cn("shrink-0 text-xs font-semibold", MONO, "text-[#0d9488]")}>
              {habit.figure}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              {habit.rail.map((mark, i) =>
                // A day with nothing to judge is a dash, not an empty dot: a
                // habit added on Wednesday has not missed Monday, and a Mon,
                // Wed, Fri habit has not missed Tuesday. An unfilled dot would
                // say it had.
                mark === "done" || mark === "missed" ? (
                  <span
                    key={i}
                    className={`w-2 h-2 rounded-full ${
                      mark === "done" ? "bg-[#0d9488]" : "bg-[rgba(13,148,136,0.12)]"
                    }`}
                  />
                ) : (
                  <span key={i} className="w-2 h-px bg-[rgba(13,148,136,0.25)]" title={DASH_TITLE[mark]} />
                )
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
