import { habitDay, isWeeklyVersion, versionCovers } from "./habit-day";
import { entryMet } from "./habit-entry";
import type {
  ClientHabit,
  HabitDayFacts,
  HabitDayTally,
  HabitEntryRead,
  HabitWeek,
  HabitWeekFigures,
} from "@/types/habits";

/**
 * Every habit figure (docs/HABITS-REBUILD-PLAN.md §2.2, rules 6 and 7) — pure
 * and client-safe, and the only place entries are counted.
 *
 * THE WEEK IS JUDGED; DAYS ARE SHOWN AS THEY HAPPENED. For a habit over the
 * dates of one client week, `planned` is its planned days plus, for each
 * version done N times a week, N capped at the days that version covers among
 * the dates — never more times than the days it runs that week (D2) — and
 * the weekly versions together never more than the largest N among them, so a
 * weekly habit paused, restarted or changed mid-week asks for one frequency,
 * not two added together. `done` is the days holding a met entry on a covered
 * day, planned or not, and `met` is done up to planned: the client who forgot
 * Monday and did it Tuesday is 1 of 1, while Monday still reads not done and
 * Tuesday done.
 *
 * A RANGE READ DAY BY DAY judges each day by its own planned habits alone, with
 * no credit from another day (D8: the Overview's dots; D4: the missed-habit
 * alert). A weekly habit plans no day, so it is in neither.
 */

type Habit = Pick<ClientHabit, "id" | "measure" | "direction" | "versions" | "dayEdits">;

/** The habit's entries by date. */
function entriesByDate(habitId: string, entries: readonly HabitEntryRead[]): Map<string, HabitEntryRead> {
  return new Map(entries.filter((entry) => entry.habitId === habitId).map((entry) => [entry.date, entry]));
}

/** A day as it happened: the habit's day, its entry, and whether the entry met the day's target. */
function habitDayFacts(habit: Habit, entry: HabitEntryRead | null, date: string): HabitDayFacts {
  const day = habitDay(habit, date);
  return {
    ...day,
    entry: entry ? { done: entry.done, value: entry.value, note: entry.note ?? null } : null,
    met: day.covered && entry !== null && entryMet(habit, entry, day.target),
  };
}

/** Each of `dates` as it happened, for one habit. */
export function habitDays(habit: Habit, entries: readonly HabitEntryRead[], dates: readonly string[]): HabitDayFacts[] {
  const byDate = entriesByDate(habit.id, entries);
  return dates.map((date) => habitDayFacts(habit, byDate.get(date) ?? null, date));
}

/**
 * What the habit's versions done N times a week ask of `dates`: each its N
 * capped at the days it covers among them (D2), and all of them together no
 * more than the largest N among those running.
 */
function weeklyAsk(habit: Habit, dates: readonly string[]): number {
  const running = habit.versions
    .filter(isWeeklyVersion)
    .map((version) => ({
      times: version.timesPerWeek ?? 0,
      days: dates.filter((date) => versionCovers(version, date)).length,
    }))
    .filter((version) => version.days > 0);
  const asked = running.reduce((sum, version) => sum + Math.min(version.times, version.days), 0);
  return Math.min(asked, Math.max(0, ...running.map((version) => version.times)));
}

/**
 * The habit's week over `dates` — any dates inside ONE client week: the whole
 * week, or a check-in period clamped to the client's start day.
 */
export function habitWeek(habit: Habit, entries: readonly HabitEntryRead[], dates: readonly string[]): HabitWeek {
  const days = habitDays(habit, entries, dates);
  const planned = days.filter((day) => day.planned).length + weeklyAsk(habit, dates);
  const done = days.filter((day) => day.met).length;
  return { days, figures: { planned, done, met: Math.min(done, planned) } };
}

/**
 * What a week still asks for: its planned less its met — the habit-days left
 * to do, each one doable on any day the habit runs that week. A make-up past
 * the plan lowers it no further, because met is done up to planned.
 */
export function weekToDo(figures: HabitWeekFigures): number {
  return figures.planned - figures.met;
}

/**
 * A habit's week once one of its covered days goes from met to not met, or
 * back — an entry made, changed or cleared: done moves by that day alone, and
 * met is done up to planned. Planned never turns on an entry, so it stays.
 * Moving a day to what it already was leaves the week as it is.
 */
export function weekAfterDayChange(figures: HabitWeekFigures, wasMet: boolean, isMet: boolean): HabitWeekFigures {
  const done = figures.done - (wasMet ? 1 : 0) + (isMet ? 1 : 0);
  return { planned: figures.planned, done, met: Math.min(done, figures.planned) };
}

/** Several habits' weeks added together; each habit is judged on its own first. */
export function sumWeekFigures(figures: readonly HabitWeekFigures[]): HabitWeekFigures {
  return figures.reduce(
    (total, week) => ({
      planned: total.planned + week.planned,
      done: total.done + week.done,
      met: total.met + week.met,
    }),
    { planned: 0, done: 0, met: 0 }
  );
}

/** Each date by its own planned habits: how many were planned, how many of those were done on the day itself. */
export function habitDayTallies(
  habits: readonly Habit[],
  entries: readonly HabitEntryRead[],
  dates: readonly string[]
): HabitDayTally[] {
  const byHabit = habits.map((habit) => habitDays(habit, entries, dates));
  return dates.map((date, i) => {
    const planned = byHabit.map((days) => days[i]).filter((day) => day.planned);
    return { date, planned: planned.length, done: planned.filter((day) => day.met).length };
  });
}

/**
 * The habit's planned days among `dates` that went without it done on the day
 * (D4): a number short of its target is missed, and a day made up on another
 * day is still missed on its own. A weekly habit plans no day, so it misses none.
 */
export function missedPlannedDates(habit: Habit, entries: readonly HabitEntryRead[], dates: readonly string[]): string[] {
  return habitDays(habit, entries, dates)
    .filter((day) => day.planned && !day.met)
    .map((day) => day.date);
}
