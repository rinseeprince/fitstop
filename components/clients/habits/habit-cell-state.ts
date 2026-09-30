import type { HabitDayFacts } from "@/types/habits";

/**
 * How a day of the Habits tab's week tracker reads, from the day as it
 * happened (the kernel's facts) and the client's today — the check-in
 * review's rule, with today still open:
 *
 * - `done`: met on the day — a tick, or a number at its target;
 * - `missed`: a planned day gone by that was not met — no entry, not done, or
 *   a number short of its target;
 * - `pending`: today, planned and not met yet — nothing entered, unticked, or
 *   a number short of its target so far. Today is never a miss;
 * - `blank`: nothing to judge — a day no version covers, a day ahead, or a
 *   day not planned and not met, even with an entry (a set-days habit's other
 *   days, and every day of a habit done a number of times a week). Only a
 *   planned day can be missed.
 *
 * The facts decide; nothing here counts or compares a number with its target.
 */
export type HabitCellState = "done" | "missed" | "pending" | "blank";

export function habitCellState(day: HabitDayFacts, today: string): HabitCellState {
  if (!day.covered) return "blank";
  if (day.met) return "done";
  if (!day.planned || day.date > today) return "blank";
  return day.date === today ? "pending" : "missed";
}
