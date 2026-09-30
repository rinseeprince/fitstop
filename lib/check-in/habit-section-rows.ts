import type { SentHabitWeek } from "@/lib/check-in/sent-snapshot";

/**
 * The coach review's Habits section, row by row, from a sent check-in's habit
 * week — pure, so a test and the proof over every saved copy
 * (`scripts/check-in-copies-read-proof.ts`) read exactly what the section draws. Each row is a habit planned at least once that
 * week: its name as it stood, the week's figure (met of planned) and one
 * mark per day as it happened. A habit with nothing planned that week says
 * nothing about it and has no row, as a habit that did not exist that week
 * never had one.
 */

/**
 * A day's mark: done (met on the day), missed (planned, not met), or a dash —
 * the habit not planned that day, not added yet (before the day it first
 * started, however long before the week that was), or not running (a gap or a
 * stop).
 */
export type HabitRailMark = "done" | "missed" | "not_planned" | "not_yet_added" | "not_running";

type HabitSectionRow = {
  id: string;
  name: string;
  /** "5/7": the week's met over its planned. */
  figure: string;
  rail: HabitRailMark[];
};

export function habitSectionRows(week: SentHabitWeek | null): HabitSectionRow[] {
  if (!week) return [];
  return week.habits
    .filter((habit) => habit.figures.planned > 0)
    .map((habit) => ({
      id: habit.id,
      name: habit.name,
      figure: `${habit.figures.met}/${habit.figures.planned}`,
      rail: habit.days.map((day): HabitRailMark => {
        if (day.met) return "done";
        if (day.planned) return "missed";
        if (day.covered) return "not_planned";
        // The row's own first start, from the habit's whole history: the
        // week's versions alone would read a habit started again inside the
        // week as never added before it.
        return day.date < habit.firstStartsOn ? "not_yet_added" : "not_running";
      }),
    }));
}
