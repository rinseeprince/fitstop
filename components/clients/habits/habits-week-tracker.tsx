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
import {
  LABEL_CLASS,
  MONO,
  TEXT_MUTED,
} from "@/components/clients/training/program-builder/builder-tokens";
import { weekFigurePercent } from "@/lib/habits/habit-words";
import { HabitDayCell } from "./habit-day-cell";
import { habitCellState } from "./habit-cell-state";
import { habitFigure } from "./habit-figure";
import type { HabitWeekRow } from "@/types/habits";

type HabitsWeekTrackerProps = {
  habits: HabitWeekRow[];
  weekDays: string[];
  /** The client's today: the day ringed, and the edge between a missed day and one still to come. */
  today: string;
  isLoading: boolean;
};

/** The week's rate from which a row's rate reads teal rather than muted. */
const WEEK_RATE_STRONG_PERCENT = 70;

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
        <div className="h-24 flex items-center justify-center text-[13px] text-[#93b0b4]">
          No habits this week
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[6px] p-5">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-[rgba(13,148,136,0.08)] hover:bg-transparent">
            <TableHead className={cn(LABEL_CLASS, "min-w-[140px] h-10")}>
              Habit
            </TableHead>
            {weekDays.map((date) => {
              const { dayAbbr, dateNum } = formatDayHeader(date);
              const isToday = date === today;
              return (
                <TableHead
                  key={date}
                  className={cn(
                    // normal-case/tracking-normal: TableHead now carries
                    // LABEL_CLASS, and these headers hold a mixed-case day
                    // abbreviation ("Mon"), not a label.
                    "text-center min-w-[48px] h-10 px-1 normal-case tracking-normal",
                    isToday && "bg-[rgba(13,148,136,0.05)] rounded-t-[4px]"
                  )}
                >
                  <div className="text-[10px] text-[#93b0b4] font-medium">{dayAbbr}</div>
                  <div
                    className={cn(
                      MONO,
                      "text-[12px]",
                      isToday ? "text-[#0d9488] font-semibold" : "text-[#5a7d82]"
                    )}
                  >
                    {dateNum}
                  </div>
                </TableHead>
              );
            })}
            <TableHead className={cn(LABEL_CLASS, "text-right min-w-[60px] h-10")}>
              Rate
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {habits.map((row) => {
            // The Rate cell reads met of planned; its percentage decides the colour.
            const rate = weekFigurePercent(row.figures);
            const figure = habitFigure(row.figures.met, row.figures.planned);
            return (
              <TableRow
                key={row.habit.id}
                className="border-b border-[rgba(13,148,136,0.06)] hover:bg-[rgba(13,148,136,0.02)] transition-colors"
              >
                <TableCell className="py-2.5">
                  <span className="text-[13px] font-medium text-[#0c1a1e]">
                    {row.habit.name}
                  </span>
                  {/* Words ("at least 3 L"), so sans: mono is for numbers alone. */}
                  {row.words.target && (
                    <span className={cn(TEXT_MUTED, "text-[11px] ml-1.5")}>· {row.words.target}</span>
                  )}
                </TableCell>
                {row.days.map((day) => {
                  const isToday = day.date === today;
                  return (
                    <TableCell
                      key={day.date}
                      className={cn(
                        "text-center py-2.5 px-1",
                        isToday && "bg-[rgba(13,148,136,0.05)]"
                      )}
                    >
                      <HabitDayCell state={habitCellState(day, today)} value={day.entry?.value ?? null} />
                    </TableCell>
                  );
                })}
                <TableCell className="text-right py-2.5">
                  <span
                    className={cn(
                      MONO,
                      "text-[13px] font-semibold",
                      rate !== null && rate >= WEEK_RATE_STRONG_PERCENT ? "text-[#0d9488]" : "text-[#93b0b4]"
                    )}
                  >
                    {figure ?? "—"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
