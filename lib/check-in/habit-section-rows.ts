import { habitAverage, habitFigure } from "@/lib/check-in/review-figures";
import { isWeeklyVersion, versionForWords, versionOn } from "@/lib/habits/habit-day";
import { habitWords, targetWords, wordsLine } from "@/lib/habits/habit-words";
import type { SentHabitWeek } from "@/lib/check-in/sent-snapshot";

/**
 * The coach review's Habits section, row by row, from a sent check-in's habit
 * week (docs/HABITS-REBUILD-PLAN.md §2.5, commit 6) — pure, so a test and the
 * proof over every saved copy (`scripts/check-in-copies-read-proof.ts`) read
 * exactly what the section draws. Each row is a habit that week said something about (`habitIsListed`):
 * its name and its words as they stood — its days, then its target — one cell
 * per day as it happened, a number habit's number in it, the week's figure
 * (met of planned) and a number habit's average. Under the table, the notes
 * the client left on those habits' days.
 */

/**
 * A day's mark: done (met on the day), missed (planned, not met), or a dash —
 * the habit not planned that day, any day of a habit done N times a week, not
 * added yet (before the day it first started, however long before the week
 * that was), or not running (a gap or a stop).
 */
export type HabitRailMark = "done" | "missed" | "not_planned" | "any_day" | "not_yet_added" | "not_running";

type SentHabit = SentHabitWeek["habits"][number];
type SentDay = SentHabit["days"][number];

type HabitSectionCell = {
  date: string;
  mark: HabitRailMark;
  /** A number habit's number that day, drawn in the mark's place; null on a tick habit or with none entered. */
  value: number | null;
  /** A number habit's target that day, in words: "at least 3 L". */
  target: string | null;
};

type HabitSectionRow = {
  id: string;
  name: string;
  /** Its days, then its target, as they stood at the week's end: "Mon, Wed, Fri", "Every day · at least 3 L". */
  words: string | null;
  /** "5/7": the week's met over its planned; null when the week planned nothing. */
  figure: string | null;
  /** A number habit's average over the days it ran, "avg 2.8 L"; null on a tick habit or with no number entered. */
  average: string | null;
  cells: HabitSectionCell[];
};

/** One note the client left on a habit's day: the day, the habit and its name, and the note. */
type HabitSectionNote = { date: string; habitId: string; habit: string; note: string };

/**
 * Whether an entry records anything: a tick, a number (a 0 included) or a
 * note. A tick taken back with no note — an untick, which the client's
 * screens keep as an entry — records nothing.
 */
export function entryRecordsSomething(entry: SentDay["entry"]): boolean {
  return entry !== null && (entry.done === true || entry.value !== null || entry.note !== null);
}

/**
 * Whether the week said anything about a habit: it was planned at least once,
 * or the client recorded something for it on a day it ran — a habit done on a
 * day that was not planned, or a note the coach should read. A habit covered
 * all week and neither planned nor recorded says nothing, as a habit that did
 * not exist that week never did.
 */
function habitIsListed(habit: SentHabit): boolean {
  return habit.figures.planned > 0 || habit.days.some((day) => day.covered && entryRecordsSomething(day.entry));
}

const listed = (week: SentHabitWeek | null): SentHabit[] => (week?.habits ?? []).filter(habitIsListed);

function mark(habit: SentHabit, day: SentDay): HabitRailMark {
  if (day.met) return "done";
  if (day.planned) return "missed";
  if (day.covered) {
    const version = versionOn(habit, day.date);
    return version && isWeeklyVersion(version) ? "any_day" : "not_planned";
  }
  // The row's own first start, from the habit's whole history: the week's
  // versions alone would read a habit started again inside the week as never
  // added before it.
  return day.date < habit.firstStartsOn ? "not_yet_added" : "not_running";
}

export function habitSectionRows(week: SentHabitWeek | null): HabitSectionRow[] {
  return listed(week).map((habit) => {
    const lastDay = habit.days[habit.days.length - 1]?.date ?? habit.firstStartsOn;
    return {
      id: habit.id,
      name: habit.name,
      words: wordsLine(habitWords(habit, versionForWords(habit, lastDay))),
      figure: habitFigure(habit.figures)?.fraction ?? null,
      average: habitAverage(habit, habit.days),
      cells: habit.days.map((day) => ({
        date: day.date,
        mark: mark(habit, day),
        value: day.covered ? (day.entry?.value ?? null) : null,
        target: day.covered ? targetWords(habit, day.target) : null,
      })),
    };
  });
}

/**
 * The notes the client left on the listed habits' days, oldest day first and
 * in the habits' order within a day. A note on a day no version covered is in
 * no figure, and is left out with its entry.
 */
export function habitSectionNotes(week: SentHabitWeek | null): HabitSectionNote[] {
  const habits = listed(week);
  const dates = habits[0]?.days.map((day) => day.date) ?? [];
  return dates.flatMap((date) =>
    habits.flatMap((habit) => {
      const day = habit.days.find((each) => each.date === date);
      const note = day?.covered ? day.entry?.note : null;
      return note ? [{ date, habitId: habit.id, habit: habit.name, note }] : [];
    })
  );
}
