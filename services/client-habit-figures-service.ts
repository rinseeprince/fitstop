import { getClientWeekAnchor } from "./check-in-week-service";
import { getClientHabit, listClientHabits, listHabitEntries } from "./client-habits-service";
import { HabitWriteError } from "./client-habit-writes-service";
import { getClientTodayString } from "./today-service";
import {
  addDaysToDateString,
  expandDateRange,
  getTrainingWeekDays,
  getTrainingWeekStart,
} from "@/lib/date-helpers";
import { versionForWords, versionOn } from "@/lib/habits/habit-day";
import { habitDays, habitDayTallies, habitWeek, sumWeekFigures } from "@/lib/habits/habit-week";
import { habitWords, weekFigureWords } from "@/lib/habits/habit-words";
import { HABIT_PROGRESS_DAYS } from "@/lib/constants";
import type { DayOfWeek } from "@/types/check-in";
import type {
  ClientHabit,
  ClientHabitDay,
  ClientHabitProgress,
  ClientHabitWeek,
  CoachHabitWeek,
  HabitEntry,
  HabitEntryResult,
  HabitIdentity,
  HabitWeekRow,
} from "@/types/habits";

/**
 * A client's habit figures, assembled (docs/HABITS-REBUILD-PLAN.md §2.3): the
 * client's habits and entries over the days asked, the client's week anchor
 * (`getClientWeekAnchor` — the weekday their check-in week ends on) and the
 * client's today (`getClientTodayString`), handed to the kernel in
 * `lib/habits/`, which is the only place a habit figure is worked out. Every
 * figure is on the CLIENT's calendar (ARCHITECTURE "Timezone model").
 *
 * Each read is two rounds of queries, bounded by the days asked and never by
 * the client's history: the anchor and the client's today, then the habits
 * and the entries over those days (the entries paged, 1,000 rows a page).
 */

/** A week that is not inside one of the client's weeks. */
export class HabitWeekRangeError extends Error {
  constructor() {
    super("The dates must be inside one week.");
    this.name = "HabitWeekRangeError";
  }
}

function habitIdentity(habit: ClientHabit): HabitIdentity {
  return {
    id: habit.id,
    name: habit.name,
    howTo: habit.howTo,
    measure: habit.measure,
    unit: habit.unit,
    direction: habit.direction,
  };
}

/** Whether any of the habit's versions covers one of the dates. */
const coversAny = (habit: ClientHabit, dates: readonly string[]) => dates.some((date) => versionOn(habit, date));

/** Each habit a version covers during `dates`, its days as they happened, its figures and its words. */
function weekRows(habits: ClientHabit[], entries: HabitEntry[], dates: string[]): HabitWeekRow[] {
  return habits
    .filter((habit) => coversAny(habit, dates))
    .map((habit) => {
      const week = habitWeek(habit, entries, dates);
      return {
        habit: habitIdentity(habit),
        words: habitWords(habit, versionForWords(habit, dates[dates.length - 1])),
        days: week.days,
        figures: week.figures,
      };
    });
}

/** The client's habits and entries over from..to, read together. */
async function readRange(clientId: string, from: string, to: string) {
  const range = { from, to };
  const [habits, entries] = await Promise.all([
    listClientHabits(clientId, range),
    listHabitEntries(clientId, range),
  ]);
  return { habits, entries };
}

/**
 * The coach's week tracker and summary: the client week holding `day` — the
 * client's today when absent — each habit's days and figures, the totals, and
 * today's planned habits and how many were done today.
 */
export async function getCoachHabitWeek(clientId: string, day?: string): Promise<CoachHabitWeek> {
  const [anchor, today] = await Promise.all([getClientWeekAnchor(clientId), getClientTodayString(clientId)]);
  const dates = getTrainingWeekDays(day ?? today, anchor.weekday);
  const [start, end] = [dates[0], dates[dates.length - 1]];
  const { habits, entries } = await readRange(clientId, start, end);

  const rows = weekRows(habits, entries, dates);
  const tally = dates.includes(today) ? habitDayTallies(habits, entries, [today])[0] : null;
  return {
    clientToday: today,
    start,
    end,
    dates,
    habits: rows,
    totals: sumWeekFigures(rows.map((row) => row.figures)),
    today: tally ? { planned: tally.planned, done: tally.done } : null,
  };
}

/**
 * The client's day: every habit a version covers on `date` — planned that day
 * or not — with the day as it stands, the week holding it, and its words.
 */
export async function getClientHabitDay(clientId: string, date: string): Promise<ClientHabitDay> {
  const anchor = await getClientWeekAnchor(clientId);
  const dates = getTrainingWeekDays(date, anchor.weekday);
  const [start, end] = [dates[0], dates[dates.length - 1]];
  const { habits, entries } = await readRange(clientId, start, end);

  return {
    date,
    habits: habits
      .filter((habit) => versionOn(habit, date))
      .map((habit) => {
        const week = habitWeek(habit, entries, dates);
        const day = week.days[dates.indexOf(date)];
        return {
          habit: habitIdentity(habit),
          day,
          week: { ...week.figures, start, end },
          words: { ...habitWords(habit, versionOn(habit, date), day.target), week: weekFigureWords(week.figures) },
        };
      }),
  };
}

/**
 * The habit week over `start`..`end`, dates inside one client week — the
 * check-in's period, which a partial first week clamps to the client's start
 * day. Refused with `HabitWeekRangeError` otherwise.
 */
export async function getClientHabitWeek(clientId: string, start: string, end: string): Promise<ClientHabitWeek> {
  const anchor = await getClientWeekAnchor(clientId);
  if (end < start || getTrainingWeekStart(start, anchor.weekday) !== getTrainingWeekStart(end, anchor.weekday)) {
    throw new HabitWeekRangeError();
  }
  const dates = expandDateRange(start, end);
  const { habits, entries } = await readRange(clientId, start, end);

  const rows = weekRows(habits, entries, dates);
  return { start, end, dates, habits: rows, totals: sumWeekFigures(rows.map((row) => row.figures)) };
}

/**
 * One habit's day and the client week holding it, as they stand — the entry
 * routes' answer. The caller hands in the week's anchor (`getClientWeekAnchor`),
 * read alongside its write rather than after it.
 */
export async function getHabitEntryResult(
  clientId: string,
  habitId: string,
  date: string,
  anchor: { weekday: DayOfWeek }
): Promise<HabitEntryResult> {
  const dates = getTrainingWeekDays(date, anchor.weekday);
  const range = { from: dates[0], to: dates[dates.length - 1] };
  const [habit, entries] = await Promise.all([
    getClientHabit(clientId, habitId, range),
    listHabitEntries(clientId, range, habitId),
  ]);
  if (!habit) throw new HabitWriteError("not_found", "the habit is not this client's");

  const week = habitWeek(habit, entries, dates);
  return { day: week.days[dates.indexOf(date)], week: { ...week.figures, start: range.from, end: range.to } };
}

/**
 * The Journey: for each habit a version covers during the span, its figures
 * over the last `weeks` client weeks — the last holding today — and its last
 * days as they happened, ending today.
 */
export async function getClientHabitProgress(clientId: string, weeks: number): Promise<ClientHabitProgress> {
  const [anchor, today] = await Promise.all([getClientWeekAnchor(clientId), getClientTodayString(clientId)]);
  const thisWeek = getTrainingWeekDays(today, anchor.weekday);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDaysToDateString(thisWeek[0], -7 * (weeks - 1 - i)));
  const days = expandDateRange(addDaysToDateString(today, -(HABIT_PROGRESS_DAYS - 1)), today);
  const from = weekStarts[0] < days[0] ? weekStarts[0] : days[0];
  const to = thisWeek[thisWeek.length - 1];
  const span = expandDateRange(from, to);
  const weekDates = weekStarts.map((start) => expandDateRange(start, addDaysToDateString(start, 6)));
  const { habits, entries } = await readRange(clientId, from, to);

  return {
    clientToday: today,
    habits: habits
      .filter((habit) => coversAny(habit, span))
      .map((habit) => {
        const own = entries.filter((entry) => entry.habitId === habit.id);
        return {
          habit: habitIdentity(habit),
          words: habitWords(habit, versionForWords(habit, today)),
          weeks: weekDates.map((dates) => ({
            ...habitWeek(habit, own, dates).figures,
            start: dates[0],
            end: dates[dates.length - 1],
          })),
          days: habitDays(habit, own, days),
        };
      }),
  };
}
