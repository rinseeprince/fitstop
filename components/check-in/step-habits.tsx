"use client";

import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HabitNumberBox } from "@/components/client-portal/habits/habit-number-box";
import { toastHabitEntryError } from "@/components/client-portal/habits/habit-entry-toast";
import {
  MONO,
  MONO_CELL_CLASS,
  MONO_META_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useCheckInHabitWeek } from "@/hooks/use-check-in-habit-week";
import { canEditDay } from "@/lib/daily-log-permissions";
import { dayOfMonth, formatDateOnlyShort, SHORT_WEEKDAY, weekdayOf } from "@/lib/date-helpers";
import { weekFigureWords, wordsLine } from "@/lib/habits/habit-words";
import { cn } from "@/lib/utils";
import type { ClientHabitWeek, HabitAnswer, HabitDayFacts, HabitWeekRow } from "@/types/habits";

type StepHabitsProps = {
  /** The check-in context's habit week: the step's first answer, shown from the first frame. */
  habitWeek: ClientHabitWeek;
  /** The client's IANA timezone: the day rule's "today". */
  clientTimezone: string;
  /** The day rule's first open day, from the check-in context; null: no lower bound. */
  logsOpenFrom: string | null;
  /** Hands the page each entry write, which Send waits for. */
  trackWrite: (write: Promise<unknown>) => void;
  /** The check-in is being sent: an entry made now would race the week's freeze, so none can be. */
  disabled: boolean;
};

// The habit column stays put while the days scroll under it on a narrow
// screen, as the review's week does — with the row hover's opaque twin, so
// the pinned cell tints with its row.
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";

/** "Fri 25 Sept": a day as a cell names it to a screen reader. */
const dayName = (date: string) => `${SHORT_WEEKDAY[weekdayOf(date)]} ${formatDateOnlyShort(date)}`;

type DayEntryProps = {
  row: HabitWeekRow;
  day: HabitDayFacts;
  /** The day rule leaves the day open. */
  open: boolean;
  onAnswer: (answer: HabitAnswer) => void;
  onClear: () => void;
};

/**
 * One habit on one day: a tick or a number box on every day a version covers
 * — planned or not, while the day rule leaves it open — and a dot under it on
 * a day the coach planned. A day no version covers holds nothing to enter.
 */
function DayEntry({ row, day, open, onAnswer, onClear }: DayEntryProps) {
  const { habit } = row;
  if (!day.covered) {
    return (
      <span className="block text-center text-[13px] text-[#c2d0cc]">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{`${habit.name} is not running on ${dayName(day.date)}`}</span>
      </span>
    );
  }
  const name = `${habit.name}, ${dayName(day.date)}${day.planned ? ", planned" : ""}`;
  return (
    <div className="flex flex-col items-center gap-1">
      {habit.measure === "tick" ? (
        <Checkbox
          checked={day.entry?.done === true}
          onCheckedChange={(checked) => onAnswer({ done: checked === true })}
          disabled={!open}
          aria-label={name}
          className="size-5"
        />
      ) : (
        <HabitNumberBox
          id={`habit-${habit.id}-${day.date}`}
          label={name}
          className="h-8 w-16 px-2"
          value={day.entry?.value ?? null}
          unit={null}
          disabled={!open}
          onCommit={(value) => (value === null ? onClear() : onAnswer({ value }))}
          onInvalid={(reason) => toast.error(`Couldn't save ${habit.name}`, { description: reason })}
        />
      )}
      <span
        aria-hidden="true"
        data-planned={day.planned || undefined}
        className={cn("h-1 w-1 rounded-full", day.planned ? "bg-[#0d9488]" : "bg-transparent")}
      />
    </div>
  );
}

/**
 * The check-in's Habits step (docs/HABITS-REBUILD-PLAN.md §2.5), last in the
 * wizard: the week the check-in reports on, one row per habit a version
 * covered that week, one column per day. Every day a version covers takes the
 * client's tick or number, planned or not, while the day rule leaves it open
 * and the check-in is not being sent; a planned day is marked; each row ends
 * with its week's figure, which moves as the client fills a gap. Each entry
 * saves on its own — a tick at once, a number when the client leaves its box
 * — and the page waits for every one before it sends the check-in. A note is
 * made on the habits page: a tick, an untick or a new number keeps the day's
 * note, and emptying a number box clears the entry, its note with it, as on
 * the habits page.
 */
export function StepHabits({ habitWeek, clientTimezone, logsOpenFrom, trackWrite, disabled }: StepHabitsProps) {
  const { week, save, clear } = useCheckInHabitWeek(habitWeek);

  const run = (write: Promise<void>) => {
    trackWrite(write);
    void write.catch(toastHabitEntryError);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
          <h3 className="text-lg font-semibold">Your habits</h3>
          {week.dates.length > 0 && (
            <span className={cn("text-[12px]", MONO_META_CLASS)}>
              {`${formatDateOnlyShort(week.dates[0])} – ${formatDateOnlyShort(week.dates[week.dates.length - 1])}`}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Tick or enter any day you missed. A dot marks a day your coach planned.
        </p>
      </div>

      {week.habits.length === 0 ? (
        <p className={cn("text-[13px]", TEXT_MUTED)}>No habits this week</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(PINNED_CELL, "min-w-[150px] pl-0")}>Habit</TableHead>
              {week.dates.map((date) => (
                // normal-case/tracking-normal: these headers hold a mixed-case
                // day ("Thu"), not a label — the coach's tracker's columns.
                <TableHead key={date} className="min-w-[68px] text-center normal-case tracking-normal">
                  <div className="text-[10px] font-medium text-[#93b0b4]">{SHORT_WEEKDAY[weekdayOf(date)]}</div>
                  <div className={cn(MONO, "text-[12px] text-[#5a7d82]")}>{dayOfMonth(date)}</div>
                </TableHead>
              ))}
              <TableHead className="pr-0 text-right">Week</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {week.habits.map((row) => {
              const line = wordsLine(row.words);
              return (
                <TableRow key={row.habit.id} className="group/row">
                  <TableCell className={cn(PINNED_CELL, PINNED_ROW_HOVER, "pl-0")}>
                    <p className={cn("max-w-[220px] truncate text-[13.5px] font-semibold", TEXT_PRIMARY)}>{row.habit.name}</p>
                    {line && <p className={cn("mt-0.5 max-w-[220px] truncate text-xs", TEXT_MUTED)}>{line}</p>}
                  </TableCell>
                  {row.days.map((day) => (
                    <TableCell key={day.date} className="text-center">
                      <DayEntry
                        row={row}
                        day={day}
                        open={!disabled && canEditDay(day.date, logsOpenFrom, clientTimezone)}
                        onAnswer={(answer) => run(save(row, day.date, answer))}
                        onClear={() => run(clear(row, day.date))}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap pr-0 text-right">
                    {row.figures.planned > 0 ? (
                      <span className={cn(MONO_CELL_CLASS, "font-semibold", TEXT_PRIMARY)}>{weekFigureWords(row.figures)}</span>
                    ) : (
                      <span className={cn("text-[12px]", TEXT_MUTED)}>{weekFigureWords(row.figures)}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
