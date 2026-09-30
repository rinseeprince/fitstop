import { formatDateOnlyShort } from "@/lib/date-helpers";
import { habitWords } from "@/lib/habits/habit-words";
import type { CoachHabit, CoachHabitList, CoachHabitWeek, HabitDayFacts, HabitWeekFigures, HabitWeekRow, HabitWords } from "@/types/habits";

/**
 * The Habits tab's table, one row per habit: every habit the coach manages —
 * running and starting later first, then the stopped, each group in the
 * client's order (the owner's order at commit 2's smoke: stopped habits last,
 * with no heading) — then any other habit the week shows: one the coach
 * deleted since, whose past days stay, as the week read says. A row's days
 * are the week's as they happened, or none when no version covers a day of it.
 */
export type HabitTrackerRow = {
  id: string;
  name: string;
  /**
   * Line 2, one style on every row: the days, then the target ("Every day ·
   * at least 3 L"); a habit starting later, its first day first; a stopped
   * habit "Stopped" alone; one deleted since, "Deleted" alone.
   */
  line: string | null;
  /**
   * The habit as the coach manages it, for its ⋯ and its days; null for a
   * habit the list does not hold — one deleted since, which nothing changes,
   * or, for as long as the list takes to catch up with the week, a new one.
   */
  habit: CoachHabit | null;
  /** Each day of the week as it happened; null when no version covers any of them. */
  days: HabitDayFacts[] | null;
  /** The week's met of planned; null when no version covers any of its days. */
  figures: HabitWeekFigures | null;
  /** Stopped or deleted: the name and line 2 read quieter, never the days. */
  quiet: boolean;
};

/** Days, then target, as every habit line reads. */
function wordsLine(words: HabitWords): string | null {
  const parts = [words.schedule, words.target].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * A managed habit's line 2. Running: on the week holding the client's today,
 * its words today; on another week, the words that week gave it — the target
 * its days were judged against — else its words today. Starting later: the
 * day it starts, then that version's words, which a stopped habit queued to
 * start again has not had yet.
 */
function managedLine(habit: CoachHabit, weekRow: HabitWeekRow | undefined, clientToday: string, holdsToday: boolean): string | null {
  if (habit.status === "stopped") return "Stopped";
  if (habit.status === "upcoming") {
    const next = habit.versions.find((version) => version.startsOn > clientToday);
    if (next) {
      const words = wordsLine(habitWords(habit, next));
      return [`Starts ${formatDateOnlyShort(next.startsOn)}`, words].filter(Boolean).join(" · ");
    }
  }
  return wordsLine(!holdsToday && weekRow ? weekRow.words : habit.words);
}

export function habitTrackerRows(list: CoachHabitList, week: CoachHabitWeek): HabitTrackerRow[] {
  const weekRows = new Map(week.habits.map((row) => [row.habit.id, row]));
  const managed = new Set(list.habits.map((habit) => habit.id));
  const holdsToday = week.dates.includes(list.clientToday);
  const row = (habit: CoachHabit): HabitTrackerRow => {
    const weekRow = weekRows.get(habit.id);
    return {
      id: habit.id,
      name: habit.name,
      line: managedLine(habit, weekRow, list.clientToday, holdsToday),
      habit,
      days: weekRow?.days ?? null,
      figures: weekRow?.figures ?? null,
      quiet: habit.status === "stopped",
    };
  };
  return [
    ...list.habits.filter((habit) => habit.status !== "stopped").map(row),
    ...list.habits.filter((habit) => habit.status === "stopped").map(row),
    // "Deleted" is the week read's own word, never a guess from a habit
    // missing from the list: a habit added in another window, which the week
    // re-read on the coach's return shows before the list does, is no deleted one.
    ...week.habits
      .filter((weekRow) => !managed.has(weekRow.habit.id))
      .map((weekRow) => ({
        id: weekRow.habit.id,
        name: weekRow.habit.name,
        line: weekRow.deleted ? "Deleted" : wordsLine(weekRow.words),
        habit: null,
        days: weekRow.days,
        figures: weekRow.figures,
        quiet: weekRow.deleted,
      })),
  ];
}

/**
 * The running and starting-later habits in the client's order: the ones a
 * move can reorder, within themselves (the owner's drawer rule, kept).
 */
export function movableHabitIds(list: CoachHabitList): string[] {
  return list.habits.filter((habit) => habit.status !== "stopped").map((habit) => habit.id);
}
