import { entryMet } from "./habit-entry";
import { sumWeekFigures, weekAfterDayChange } from "./habit-week";
import type { ClientHabitWeek, HabitDayFacts, HabitEntryResult, HabitWeekRow } from "@/types/habits";

/**
 * A client habit week — the check-in's Habits step (docs/HABITS-REBUILD-PLAN.md
 * §6, commit 6) — moved by one day of one habit, as the server answered it or
 * as the client has just changed it. Pure and client-safe.
 *
 * Planned never turns on an entry, so a day's change moves its habit's figures
 * by that day alone (`weekAfterDayChange`: done up or down by one, met done up
 * to planned), over whichever dates the week holds — a check-in period clamped
 * to the client's start day included, which the entry route's own week, the
 * whole client week, would not match. The totals are the habits' figures added
 * up again. Nothing here counts entries.
 */

/**
 * Whether two readings of one habit's day agree on its plan: covered or not,
 * planned or not, its target and its N a week. An entry's answer that does not
 * agree with the day the step holds says the coach changed the habit
 * underneath it — its other days may have changed too — so the answer's day
 * alone cannot be landed on the week.
 */
export function sameDayPlan(
  a: Pick<HabitDayFacts, "covered" | "planned" | "target" | "timesPerWeek">,
  b: Pick<HabitDayFacts, "covered" | "planned" | "target" | "timesPerWeek">
): boolean {
  return a.covered === b.covered && a.planned === b.planned && a.target === b.target && a.timesPerWeek === b.timesPerWeek;
}

/**
 * The week with one habit's day replaced — the entry route's answer for it —
 * and that habit's figures moved by the day alone. A habit or a date the week
 * does not hold leaves it as it is.
 */
export function weekWithDay(week: ClientHabitWeek, habitId: string, day: HabitDayFacts): ClientHabitWeek {
  let moved = false;
  const habits = week.habits.map((row) => {
    if (row.habit.id !== habitId) return row;
    const index = row.days.findIndex((each) => each.date === day.date);
    if (index === -1) return row;
    moved = true;
    return {
      ...row,
      days: row.days.map((each, i) => (i === index ? day : each)),
      figures: weekAfterDayChange(row.figures, row.days[index].met, day.met),
    };
  });
  if (!moved) return week;
  return { ...week, habits, totals: sumWeekFigures(habits.map((row) => row.figures)) };
}

/**
 * Whether the entry route's answer can land on the step's week by its day
 * alone: the day is planned as the week holds it (`sameDayPlan`), and the
 * week holds the whole client week the answer counts, whose figures the
 * habit's row moved by that day matches. Anything else says the week must be
 * read again: the coach changed the habit underneath — that day's plan, or
 * another day's — or the step holds a first week clamped to the start day,
 * which the answer's whole week cannot vouch for.
 */
export function answerLandsAlone(week: ClientHabitWeek, habitId: string, answer: HabitEntryResult): boolean {
  const before = week.habits.find((row) => row.habit.id === habitId)?.days.find((day) => day.date === answer.day.date);
  if (!before || !sameDayPlan(before, answer.day)) return false;
  if (week.start !== answer.week.start || week.end !== answer.week.end) return false;
  const moved = weekWithDay(week, habitId, answer.day).habits.find((row) => row.habit.id === habitId)!;
  return (
    moved.figures.planned === answer.week.planned && moved.figures.done === answer.week.done && moved.figures.met === answer.week.met
  );
}

/**
 * The week with one habit as another read of the same dates has it: its row
 * replaced, or left out when that read no longer lists it — the coach deleted
 * the habit — and the totals added up again. A habit the week does not hold is
 * not added: the step lists what the check-in opened with.
 */
export function weekWithRow(week: ClientHabitWeek, habitId: string, row: HabitWeekRow | null): ClientHabitWeek {
  if (!week.habits.some((each) => each.habit.id === habitId)) return week;
  const habits = row
    ? week.habits.map((each) => (each.habit.id === habitId ? row : each))
    : week.habits.filter((each) => each.habit.id !== habitId);
  return { ...week, habits, totals: sumWeekFigures(habits.map((each) => each.figures)) };
}

/**
 * The week with a new entry on one day of one habit — a tick, a number, or
 * none — judged by the kernel against that day's target (`entryMet`). A day no
 * version covers takes no entry, so it leaves the week as it is.
 */
export function weekWithEntry(
  week: ClientHabitWeek,
  habitId: string,
  date: string,
  entry: HabitDayFacts["entry"]
): ClientHabitWeek {
  const row = week.habits.find((each) => each.habit.id === habitId);
  const day = row?.days.find((each) => each.date === date);
  if (!row || !day || !day.covered) return week;
  const met = entry !== null && entryMet(row.habit, entry, day.target);
  return weekWithDay(week, habitId, { ...day, entry, met });
}
