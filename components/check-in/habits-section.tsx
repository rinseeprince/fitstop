"use client";

import { motion } from "framer-motion";
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
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.14 }}
        className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
      >
        <div className="flex gap-6 flex-wrap">
          {habits.map((habit) => (
            <div key={habit.id} className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#0c1a1e]">{habit.name}</span>
              <span className={cn("text-xs font-semibold", MONO, "text-[#0d9488]")}>
                {habit.completedDays}/{habit.eligibleDays}
              </span>
              <span className="flex items-center gap-0.5">
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
      </motion.div>
    </div>
  );
};
