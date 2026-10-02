import { getClientWeekAnchor } from "./check-in-week-service";
import {
  getClientHabit,
  listClientHabits,
  listClientHabitsWithEntryCheck,
  listDeletedHabitIds,
  listHabitEntries,
} from "./client-habits-service";
import { HabitWriteError } from "./client-habit-writes-service";
import { getClientTodayString } from "./today-service";
import {
  addDaysToDateString,
  expandDateRange,
  getTrainingWeekDays,
  getTrainingWeekStart,
} from "@/lib/date-helpers";
import { habitStatus, versionForWords, versionOn, versionsOver } from "@/lib/habits/habit-day";
import { habitDays, habitDayTallies, habitWeek, sumWeekFigures, weekToDo } from "@/lib/habits/habit-week";
import { habitWords, weekFigureWords } from "@/lib/habits/habit-words";
import { HABIT_PROGRESS_DAYS } from "@/lib/constants";
import type { DayOfWeek } from "@/types/check-in";
import type {
  ClientHabit,
  ClientHabitDay,
  ClientHabitProgress,
  ClientHabitWeek,
  CoachHabitList,
  CoachHabitWeek,
  HabitDaySummary,
  HabitEntry,
  HabitEntryResult,
  HabitIdentity,
  HabitPeriodWeek,
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
 * Each read is at most two rounds of queries: the week anchor and the
 * client's today where it needs them, then the client's habits and the
 * entries it counts, side by side. The entries are bounded by the days asked
 * (paged, 1,000 rows a page); the habits are read whole — every habit with
 * every version it has had, the client's habit history, a coaching record of
 * tens of rows — with the one-date edits on the days asked (the coach's list
 * takes every edit and one entry per habit, `getCoachHabitList`). A check-in's
 * period week reads nothing of its own: its caller reads the rows once
 * (`readHabitRange`) and hands them over.
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

/** A client's habits and their entries over a run of days: what the kernel judges them from. */
export type HabitRange = { habits: ClientHabit[]; entries: HabitEntry[] };

/**
 * The client's habits — every one, with every version and the one-date edits
 * on from..to — and their entries on those days, read side by side.
 */
export async function readHabitRange(clientId: string, from: string, to: string): Promise<HabitRange> {
  const range = { from, to };
  const [habits, entries] = await Promise.all([
    listClientHabits(clientId, range),
    listHabitEntries(clientId, range),
  ]);
  return { habits, entries };
}

/**
 * One client week of the coach's tracker over `dates`: each habit's days and
 * figures — and whether the coach has deleted it since, read with them — the
 * totals, and today's planned habits and how many were done today.
 */
async function coachWeek(clientId: string, dates: string[], today: string): Promise<CoachHabitWeek> {
  const [start, end] = [dates[0], dates[dates.length - 1]];
  const [{ habits, entries }, deleted] = await Promise.all([
    readHabitRange(clientId, start, end),
    listDeletedHabitIds(clientId),
  ]);

  const rows = weekRows(habits, entries, dates).map((row) => ({ ...row, deleted: deleted.has(row.habit.id) }));
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

/** The client's week anchor and today, the latter read only when the caller has not. */
async function weekFrame(clientId: string, clientToday?: string) {
  const [anchor, today] = await Promise.all([
    getClientWeekAnchor(clientId),
    clientToday ?? getClientTodayString(clientId),
  ]);
  return { weekday: anchor.weekday, today };
}

/**
 * The coach's week tracker and summary: the client week holding `day` — the
 * client's today when absent. `clientToday` is the client's, when the caller
 * has already read it.
 */
export async function getCoachHabitWeek(clientId: string, day?: string, clientToday?: string): Promise<CoachHabitWeek> {
  const { weekday, today } = await weekFrame(clientId, clientToday);
  return coachWeek(clientId, getTrainingWeekDays(day ?? today, weekday), today);
}

/**
 * The client week holding `day` and, when that is not the week holding the
 * client's today, the current week as well — the Habits tab's summary always
 * shows now, whichever week its table shows. The anchor and today are read
 * once; the two weeks side by side.
 */
export async function getCoachHabitWeekAndCurrent(
  clientId: string,
  day: string,
  clientToday?: string
): Promise<{ week: CoachHabitWeek; currentWeek: CoachHabitWeek | null }> {
  const { weekday, today } = await weekFrame(clientId, clientToday);
  const dates = getTrainingWeekDays(day, weekday);
  if (dates.includes(today)) return { week: await coachWeek(clientId, dates, today), currentWeek: null };
  const [week, currentWeek] = await Promise.all([
    coachWeek(clientId, dates, today),
    coachWeek(clientId, getTrainingWeekDays(today, weekday), today),
  ]);
  return { week, currentWeek };
}

/**
 * The client's day: every habit a version covers on `date` — planned that day
 * or not — with the day as it stands, the week holding it, and its words.
 */
export async function getClientHabitDay(clientId: string, date: string): Promise<ClientHabitDay> {
  const anchor = await getClientWeekAnchor(clientId);
  const dates = getTrainingWeekDays(date, anchor.weekday);
  const [start, end] = [dates[0], dates[dates.length - 1]];
  const { habits, entries } = await readHabitRange(clientId, start, end);

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

/** The habit week over every date from `start` to `end`: each habit a version covers on one of them, and the totals. */
async function habitWeekOver(clientId: string, start: string, end: string): Promise<ClientHabitWeek> {
  const dates = expandDateRange(start, end);
  const { habits, entries } = await readHabitRange(clientId, start, end);

  const rows = weekRows(habits, entries, dates);
  return { start, end, dates, habits: rows, totals: sumWeekFigures(rows.map((row) => row.figures)) };
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
  return habitWeekOver(clientId, start, end);
}

/**
 * The habit week of the check-in the client is filling in, over its period —
 * `resolveCheckInWindow`'s, inside one client week by construction, so it
 * reads no anchor and refuses nothing. The same week the habit week route
 * answers for those dates; a period with no day — a start day after its
 * check-in day — holds no habit.
 */
export function getCheckInHabitWeek(clientId: string, periodStart: string, periodEnd: string): Promise<ClientHabitWeek> {
  return habitWeekOver(clientId, periodStart, periodEnd);
}

/**
 * A check-in's habit week over its period, `start`..`end`, as a sent
 * check-in freezes it (rule 9), from the client's habits and entries over the
 * period (`readHabitRange`, read once by the caller — the days logged count
 * the same entries): each habit a version covered during the period, in the
 * client's order — the day it first started, its versions running those
 * days, each day as it happened and the week's figures — and the week's
 * totals. The period is the check-in's own week however the client's week
 * anchor has moved since, so it needs no anchor.
 */
export function getHabitPeriodWeek({ habits, entries }: HabitRange, start: string, end: string): HabitPeriodWeek {
  const dates = expandDateRange(start, end);
  const rows = habits
    .filter((habit) => coversAny(habit, dates))
    .map((habit) => {
      const week = habitWeek(habit, entries, dates);
      return {
        habit: habitIdentity(habit),
        // From the habit's whole history, before the period's versions are
        // picked: one stopped before the period and started again inside it
        // had been added long before, so its days before the restart are not
        // running, never "not yet added". Versions come oldest first.
        firstStartsOn: habit.versions[0].startsOn,
        versions: versionsOver(habit, start, end),
        days: week.days,
        figures: week.figures,
      };
    });
  return { habits: rows, totals: sumWeekFigures(rows.map((row) => row.figures)) };
}

/**
 * The coach's list of the client's habits — running, upcoming and stopped, in
 * their order; the ones the coach deleted left out — each with every version,
 * the one-date edits from the client's today on, whether the client has made
 * an entry for it, where it stands on that today and its words. `today` is the
 * client's, when the caller has already read it.
 */
export async function getCoachHabitList(clientId: string, today?: string): Promise<CoachHabitList> {
  const [clientToday, habits] = await Promise.all([
    today ?? getClientTodayString(clientId),
    // Every edit, filtered below: the read then needs no today of its own.
    listClientHabitsWithEntryCheck(clientId, {}),
  ]);

  return {
    clientToday,
    habits: habits.map((habit) => ({
      ...habitIdentity(habit),
      position: habit.position,
      versions: habit.versions,
      dayEdits: habit.dayEdits.filter((edit) => edit.date >= clientToday),
      hasEntries: habit.hasEntries,
      status: habitStatus(habit, clientToday),
      words: habitWords(habit, versionForWords(habit, clientToday)),
    })),
  };
}

/**
 * The home card's habits on `date`: how many a version covers that day, how
 * many were planned, and how many of those were done that day — each day by
 * its own planned habits, as the Overview reads a day, so the done count is
 * never more than the planned one — and how many habit-days the client week
 * holding the date still asks of the habits running that day, each habit's
 * week judged on its own (`weekToDo`): what an entry on that day's habits page
 * can still make up. The week's anchor and the habits are read side by side:
 * the six days either side of the date hold whichever week holds it.
 */
export async function getHabitDaySummary(clientId: string, date: string): Promise<HabitDaySummary> {
  const [anchor, { habits, entries }] = await Promise.all([
    getClientWeekAnchor(clientId),
    readHabitRange(clientId, addDaysToDateString(date, -6), addDaysToDateString(date, 6)),
  ]);
  const dates = getTrainingWeekDays(date, anchor.weekday);
  const [tally] = habitDayTallies(habits, entries, [date]);
  const running = habits.filter((habit) => versionOn(habit, date));
  const week = sumWeekFigures(running.map((habit) => habitWeek(habit, entries, dates).figures));
  return {
    plannedToday: tally.planned,
    doneToday: tally.done,
    running: running.length,
    toDoThisWeek: weekToDo(week),
  };
}

/**
 * Whether the client has a habit running on their today or starting later —
 * the activation card's habits item. `today` is the client's, which the card
 * reads once for every item judged on it. Where a habit stands turns on its
 * versions alone, so no edit but today's is read.
 */
export async function hasHabitFromToday(clientId: string, today: string): Promise<boolean> {
  const habits = await listClientHabits(clientId, { from: today, to: today });
  return habits.some((habit) => habitStatus(habit, today) !== "stopped");
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
 * over the last `weeks` client weeks — the last holding today — those weeks'
 * figures added together, each week judged on its own first (the kernel's
 * `sumWeekFigures`, so no app adds them up), and its last days as they
 * happened, ending today.
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
  const { habits, entries } = await readHabitRange(clientId, from, to);

  return {
    clientToday: today,
    habits: habits
      .filter((habit) => coversAny(habit, span))
      .map((habit) => {
        const own = entries.filter((entry) => entry.habitId === habit.id);
        const weekSpans = weekDates.map((dates) => ({
          ...habitWeek(habit, own, dates).figures,
          start: dates[0],
          end: dates[dates.length - 1],
        }));
        return {
          habit: habitIdentity(habit),
          words: habitWords(habit, versionForWords(habit, today)),
          weeks: weekSpans,
          span: sumWeekFigures(weekSpans),
          days: habitDays(habit, own, days),
        };
      }),
  };
}
