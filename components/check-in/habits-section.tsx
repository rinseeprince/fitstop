"use client";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  MONO,
  MONO_CELL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { habitFigure } from "@/lib/check-in/review-figures";
import { habitSectionNotes, habitSectionRows, type HabitRailMark } from "@/lib/check-in/habit-section-rows";
import { habitNumber } from "@/lib/habits/habit-words";
import { dayOfMonth, SHORT_WEEKDAY, weekdayOf } from "@/lib/date-helpers";
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

/** A mark's words: what the day held. */
const MARK_WORDS: Record<HabitRailMark, string> = {
  done: "Done",
  missed: "Missed",
  not_planned: "Not planned",
  any_day: "Any day of the week",
  not_yet_added: "Not yet added",
  not_running: "Not running",
};

/** "Sat 26": a day as the notes name it. */
const shortDay = (date: string) => `${SHORT_WEEKDAY[weekdayOf(date)]} ${dayOfMonth(date)}`;

type CellProps = { mark: HabitRailMark; value: number | null; target: string | null };

/**
 * One day of one habit as it happened: a number habit's number — teal when it
 * met the day's target, muted when it fell short — else a dot, filled for
 * done and faint for a planned day missed, else a dash for a day with nothing
 * to judge. A dash, not an empty dot: a habit added on Wednesday has not
 * missed Monday, and a Mon, Wed, Fri habit has not missed Tuesday.
 */
function HabitDayMark({ mark, value, target }: CellProps) {
  const words = target ? `${MARK_WORDS[mark]}, target ${target}` : MARK_WORDS[mark];
  if (value !== null) {
    return (
      <span
        title={words}
        className={cn(MONO_CELL_CLASS, mark === "done" ? "font-semibold text-[#0d9488]" : TEXT_MUTED)}
      >
        {habitNumber(value)}
        <span className="sr-only">{`, ${words}`}</span>
      </span>
    );
  }
  if (mark === "done" || mark === "missed") {
    return (
      <span
        title={words}
        className={cn(
          "mx-auto block h-2 w-2 rounded-full",
          mark === "done" ? "bg-[#0d9488]" : "bg-[rgba(13,148,136,0.12)]"
        )}
      >
        <span className="sr-only">{words}</span>
      </span>
    );
  }
  return (
    <span title={words} className="mx-auto block h-px w-2 bg-[rgba(13,148,136,0.25)]">
      <span className="sr-only">{words}</span>
    </span>
  );
}

/**
 * The coach review's Habits section (docs/HABITS-REBUILD-PLAN.md §2.5): the
 * week as it was prescribed and as it happened, from the check-in's frozen
 * copy — each habit's words as they stood, a cell per day, the week's figure
 * with a number habit's average under it, and the client's notes under the
 * table — for each habit the week planned or the client recorded something
 * for on a day it ran (`habitIsListed`), the habits the AI is told about.
 * Renders nothing, its rail included, when the week said nothing about any
 * habit.
 */
export const HabitsSection = ({ habitWeek }: HabitsSectionProps) => {
  const rows = habitSectionRows(habitWeek);
  if (rows.length === 0 || !habitWeek) return null;
  const notes = habitSectionNotes(habitWeek);
  const totals = habitFigure(habitWeek.totals);
  const dates = rows[0].cells.map((cell) => cell.date);

  return (
    <div>
      <SectionLabel label="Habits" meta={totals ? `${totals.fraction} done` : undefined} />
      <div className="rounded-[6px] bg-white px-5 pb-3 pt-2">
        {/* Fixed layout: the habit and week columns hold set widths and the
            seven days share the rest of the card equally. The minimum keeps a
            day wide enough for a five-figure number; a narrower card scrolls. */}
        <Table className="min-w-[800px] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[220px] pl-0">Habit</TableHead>
              {dates.map((date) => (
                // normal-case/tracking-normal: these headers hold a mixed-case
                // day ("Thu"), not a label — the Habits tab's columns.
                <TableHead key={date} className="text-center normal-case tracking-normal">
                  <div className="text-[10px] font-medium text-[#93b0b4]">{SHORT_WEEKDAY[weekdayOf(date)]}</div>
                  <div className={cn(MONO, "text-[12px] text-[#5a7d82]")}>{dayOfMonth(date)}</div>
                </TableHead>
              ))}
              <TableHead className="w-[140px] pr-0 text-right">Week</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-habit={row.id}>
                <TableCell className="pl-0">
                  <p className={cn("truncate text-[13px] font-semibold", TEXT_PRIMARY)}>{row.name}</p>
                  {row.words && <p className={cn("mt-0.5 truncate text-xs", TEXT_MUTED)}>{row.words}</p>}
                </TableCell>
                {row.cells.map((cell) => (
                  <TableCell key={cell.date} data-day={cell.date} className="text-center">
                    <HabitDayMark mark={cell.mark} value={cell.value} target={cell.target} />
                  </TableCell>
                ))}
                {/* The week's figure, a number habit's average under it — a
                    phrase like the habit's words, so in their type. */}
                <TableCell data-col="week" className="pr-0 text-right">
                  {row.figure ? (
                    <p className={cn(MONO_CELL_CLASS, "font-semibold", TEXT_PRIMARY)}>{row.figure}</p>
                  ) : (
                    // Recorded on a day the week did not plan: nothing to judge.
                    <p className={cn("text-[12px]", TEXT_MUTED)}>Nothing planned</p>
                  )}
                  {row.average && <p className={cn("mt-0.5 text-xs", TEXT_MUTED)}>{row.average}</p>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {notes.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-[rgba(13,148,136,0.06)] pt-3">
            {notes.map((note) => (
              <li key={`${note.date}-${note.habitId}`} className="flex gap-2 text-[13px]">
                <span className={cn("shrink-0", TEXT_SECONDARY)}>{`${shortDay(note.date)} · ${note.habit}:`}</span>
                <span className={cn("whitespace-pre-wrap", TEXT_PRIMARY)}>{`“${note.note}”`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
