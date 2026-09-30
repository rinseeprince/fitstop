import type { HabitDayFacts } from "@/types/habits";

/**
 * How a day of the Habits tab's week tracker reads, from the day as it
 * happened (the kernel's facts) and the client's today — the check-in
 * review's rule, with today still open and the days ahead planned:
 *
 * - `done`: met on the day — a tick, or a number at its target;
 * - `missed`: a planned day gone by that was not met — no entry, not done, or
 *   a number short of its target;
 * - `pending`: today, planned and not met yet — nothing entered, unticked, or
 *   a number short of its target so far. Today is never a miss;
 * - `ahead`: a planned day after today, so a coach paging forward sees which
 *   days a one-date change would move;
 * - `blank`: nothing to judge — a day no version covers, or a day not planned
 *   and not met, even with an entry (a set-days habit's other days, and every
 *   day of a habit done a number of times a week). Only a planned day can be
 *   missed.
 *
 * The facts decide; nothing here counts or compares a number with its target.
 */
export type HabitCellState = "done" | "missed" | "pending" | "ahead" | "blank";

export function habitCellState(day: HabitDayFacts, today: string): HabitCellState {
  if (!day.covered) return "blank";
  if (day.met) return "done";
  if (!day.planned) return "blank";
  if (day.date > today) return "ahead";
  return day.date === today ? "pending" : "missed";
}

/**
 * Whether the coach can change this one day ("This day"): a day of a set-days
 * habit a version covers, from the client's today on. A weekly habit plans no
 * day to move, and a day gone by keeps what it had (rule 3).
 */
export function isDayEditable(day: HabitDayFacts, today: string): boolean {
  return day.covered && day.timesPerWeek === null && day.date >= today;
}
