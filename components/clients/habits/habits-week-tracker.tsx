"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HabitDayCell } from "./habit-day-cell";
import type { WeeklyHabitRow } from "@/types/history";

type HabitsWeekTrackerProps = {
  habits: WeeklyHabitRow[];
  weekDays: string[];
  today: string;
  isLoading: boolean;
};

function formatDayHeader(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  const dayAbbr = date.toLocaleDateString("en-AU", { weekday: "short" });
  const dateNum = date.getDate();
  return { dayAbbr, dateNum };
}

export function HabitsWeekTracker({
  habits,
  weekDays,
  today,
  isLoading,
}: HabitsWeekTrackerProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-[6px] p-5">
        <p className="text-[10px] uppercase tracking-[0.07em] text-[#93b0b4] font-medium mb-4">
          Habit Tracker
        </p>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (habits.length === 0) {
    return (
      <div className="bg-white rounded-[6px] p-5">
        <p className="text-[10px] uppercase tracking-[0.07em] text-[#93b0b4] font-medium mb-4">
          Habit Tracker
        </p>
        <div className="h-24 flex items-center justify-center text-[13px] text-[#93b0b4]">
          No active habits to display
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[6px] p-5">
      <p className="text-[10px] uppercase tracking-[0.07em] text-[#93b0b4] font-medium mb-4">
        Habit Tracker
      </p>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-[rgba(13,148,136,0.08)] hover:bg-transparent">
            <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium min-w-[140px] h-10">
              Habit
            </TableHead>
            {weekDays.map((date) => {
              const { dayAbbr, dateNum } = formatDayHeader(date);
              const isToday = date === today;
              return (
                <TableHead
                  key={date}
                  className={cn(
                    "text-center min-w-[48px] h-10 px-1",
                    isToday && "bg-[rgba(13,148,136,0.05)] rounded-t-[4px]"
                  )}
                >
                  <div className="text-[10px] text-[#93b0b4] font-medium">{dayAbbr}</div>
                  <div
                    className={cn(
                      "text-[12px] font-mono-display",
                      isToday ? "text-[#0d9488] font-semibold" : "text-[#5a7d82]"
                    )}
                  >
                    {dateNum}
                  </div>
                </TableHead>
              );
            })}
            <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium text-right min-w-[60px] h-10">
              Rate
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {habits.map((habit, index) => (
            <TableRow
              key={habit.habitId}
              className="border-b border-[rgba(13,148,136,0.06)] hover:bg-[rgba(13,148,136,0.02)] transition-colors animate-card-in"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <TableCell className="py-2.5">
                <span className="text-[13px] font-medium text-[#0c1a1e]">
                  {habit.habitName}
                </span>
                {!habit.isBoolean && habit.targetValue != null && (
                  <span className="text-[11px] text-[#93b0b4] ml-1.5">
                    · {habit.targetValue} {habit.targetUnit}
                  </span>
                )}
              </TableCell>
              {habit.days.map((day) => {
                const isToday = day.date === today;
                return (
                  <TableCell
                    key={day.date}
                    className={cn(
                      "text-center py-2.5 px-1",
                      isToday && "bg-[rgba(13,148,136,0.05)]"
                    )}
                  >
                    <HabitDayCell
                      status={day.status}
                      value={day.value}
                      isBoolean={habit.isBoolean}
                    />
                  </TableCell>
                );
              })}
              <TableCell className="text-right py-2.5">
                <span
                  className={cn(
                    "text-[13px] font-mono-display font-semibold",
                    habit.weeklyRate >= 70 ? "text-[#0d9488]" : "text-[#93b0b4]"
                  )}
                >
                  {habit.weeklyRate}%
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
