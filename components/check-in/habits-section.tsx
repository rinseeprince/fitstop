"use client";

import { motion } from "framer-motion";
import { RotateCw } from "lucide-react";
import type { HabitLogWithDetails } from "@/types/daily-habit";

type HabitsSectionProps = {
  habitLogs: HabitLogWithDetails[];
  contextStartDate: Date;
  contextEndDate: Date;
};

type HabitSummary = {
  name: string;
  completed: number;
  total: number;
  dailyStatus: boolean[]; // true = completed, false = missed/no data
};

function getDayRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const d = new Date(start);
  const pad = (n: number) => String(n).padStart(2, "0");
  while (d <= end) {
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export const HabitsSection = ({
  habitLogs,
  contextStartDate,
  contextEndDate,
}: HabitsSectionProps) => {
  if (habitLogs.length === 0) return null;

  const dateRange = getDayRange(contextStartDate, contextEndDate);

  // Group logs by habit
  const habitMap = new Map<string, { name: string; logs: Map<string, boolean> }>();
  for (const log of habitLogs) {
    if (!habitMap.has(log.dailyHabitId)) {
      habitMap.set(log.dailyHabitId, { name: log.habitName, logs: new Map() });
    }
    habitMap.get(log.dailyHabitId)!.logs.set(log.date, log.completed);
  }

  const habits: HabitSummary[] = Array.from(habitMap.values()).map((h) => {
    const dailyStatus = dateRange.map((date) => h.logs.get(date) ?? false);
    const completed = dailyStatus.filter(Boolean).length;
    return {
      name: h.name,
      completed,
      total: dateRange.length,
      dailyStatus,
    };
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.14 }}
      className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[#5a7d82] mb-4 flex items-center gap-2">
        <RotateCw className="w-4 h-4" strokeWidth={1.5} />
        Habits
      </div>

      <div className="flex gap-6 flex-wrap">
        {habits.map((habit) => (
          <div key={habit.name} className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#0c1a1e]">{habit.name}</span>
            <span className="text-xs font-semibold font-mono-display text-[#0d9488]">
              {habit.completed}/{habit.total}
            </span>
            <span className="flex gap-0.5">
              {habit.dailyStatus.map((done, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full ${
                    done ? "bg-[#0d9488]" : "bg-[rgba(13,148,136,0.12)]"
                  }`}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
