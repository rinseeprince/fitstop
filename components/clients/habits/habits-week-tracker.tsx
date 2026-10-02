"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDateOnlyShort, SHORT_WEEKDAY, weekdayOf } from "@/lib/date-helpers";
import { FOCUS_RING, MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { figureFraction, weekFigurePercent } from "@/lib/habits/habit-words";
import { HabitDayCell } from "./habit-day-cell";
import { habitCellState, isDayEditable } from "./habit-cell-state";
import { HabitRowMenu, type HabitRowAction } from "./habit-row-menu";
import type { HabitTrackerRow } from "./habit-tracker-rows";
import type { CoachHabit, HabitDayFacts } from "@/types/habits";

type HabitsWeekTrackerProps = {
  /** The table's rows; null while the habits or the week are still loading. */
  rows: HabitTrackerRow[] | null;
  weekDays: string[];
  /** The client's today: the day ringed, the edge between a missed day and one to come, and the first day a coach can change. */
  today: string;
  /** The running and starting-later habits, in order: the ones Move up and Move down reorder among. */
  movableIds: string[];
  /** The habit a move is in flight for: its ⋯ spins, and nothing else on the table writes until it answers. */
  movingId: string | null;
  onAction: (habit: CoachHabit, action: HabitRowAction) => void;
  /** A set-days habit's day from today on, opened in "This day". */
  onDay: (habit: CoachHabit, day: HabitDayFacts) => void;
};

/** The week's rate from which a row's figure reads teal rather than muted. */
const WEEK_RATE_STRONG_PERCENT = 70;

/** "Wed 30 Sept": a day as the tracker names it to a screen reader. */
const dayName = (date: string) => `${SHORT_WEEKDAY[weekdayOf(date)]} ${formatDateOnlyShort(date)}`;

function formatDayHeader(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return { dayAbbr: SHORT_WEEKDAY[weekdayOf(dateStr)], dateNum: date.getDate() };
}

export function HabitsWeekTracker({ rows, weekDays, today, movableIds, movingId, onAction, onDay }: HabitsWeekTrackerProps) {
  if (rows === null) {
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

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-[6px] p-5">
        <div className="h-24 flex items-center justify-center text-[13px] text-[#93b0b4]">No habits yet</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[6px] p-5">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[180px]">Habit</TableHead>
            {weekDays.map((date) => {
              const { dayAbbr, dateNum } = formatDayHeader(date);
              const isToday = date === today;
              return (
                <TableHead
                  key={date}
                  className={cn(
                    // normal-case/tracking-normal: these headers hold a
                    // mixed-case day abbreviation ("Mon"), not a label.
                    "text-center min-w-[48px] normal-case tracking-normal",
                    isToday && "bg-[rgba(13,148,136,0.05)] rounded-t-[4px]"
                  )}
                >
                  <div className="text-[10px] text-[#93b0b4] font-medium">{dayAbbr}</div>
                  <div className={cn(MONO, "text-[12px]", isToday ? "text-[#0d9488] font-semibold" : "text-[#5a7d82]")}>
                    {dateNum}
                  </div>
                </TableHead>
              );
            })}
            <TableHead className="text-right min-w-[60px]">Week</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const rate = row.figures ? weekFigurePercent(row.figures) : null;
            const figure = row.figures ? figureFraction(row.figures.met, row.figures.planned) : null;
            const habit = row.habit;
            const place = habit ? movableIds.indexOf(habit.id) : -1;
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className={cn("max-w-[260px]", row.quiet && "opacity-60")}>
                    <p className="truncate text-[13.5px] font-semibold text-[#0c1a1e]">{row.name}</p>
                    {row.line && <p className="mt-0.5 truncate text-xs text-[#93b0b4]">{row.line}</p>}
                  </div>
                </TableCell>
                {weekDays.map((date, i) => {
                  const day = row.days?.[i] ?? null;
                  const cell = (
                    <HabitDayCell
                      state={day ? habitCellState(day, today) : "blank"}
                      value={day?.entry?.value ?? null}
                      edited={day?.edited ?? false}
                    />
                  );
                  return (
                    <TableCell key={date} className={cn("text-center", date === today && "bg-[rgba(13,148,136,0.05)]")}>
                      {habit && day && isDayEditable(day, today) ? (
                        <button
                          type="button"
                          aria-label={`${row.name}, ${dayName(date)}`}
                          onClick={() => onDay(habit, day)}
                          disabled={movingId !== null}
                          className={cn(
                            "mx-auto block rounded-[4px] p-0.5 transition-colors duration-150 hover:bg-[rgba(13,148,136,0.08)] disabled:pointer-events-none",
                            FOCUS_RING
                          )}
                        >
                          {cell}
                        </button>
                      ) : (
                        cell
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right">
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
                <TableCell>
                  {habit && (
                    <HabitRowMenu
                      name={habit.name}
                      status={habit.status}
                      canMoveUp={place > 0}
                      canMoveDown={place !== -1 && place < movableIds.length - 1}
                      busy={movingId === habit.id}
                      disabled={movingId !== null}
                      onAction={(action) => onAction(habit, action)}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
