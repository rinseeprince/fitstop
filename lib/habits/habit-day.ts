import { weekdayOf } from "@/lib/date-helpers";
import type { ClientHabit, HabitDay, HabitStatus, HabitVersion } from "@/types/habits";

/**
 * A habit on one date (docs/HABITS-REBUILD-PLAN.md §2.2, rules 2 and 3) —
 * pure and client-safe, so the server, the browser and the seeds read a day
 * the same way.
 *
 * A day is COVERED when one of the habit's versions runs over it; the client
 * may make an entry on any covered day. It is PLANNED when a set-days version
 * covers it on one of its weekdays, unless a one-date edit says otherwise; a
 * version done N times a week plans no particular day. Its target is the
 * one-date edit's, else the version's — one target per version, so a day made
 * up on an unplanned day has the version's target too.
 */

/** Whether a version runs over `date`: on or after its first day, on or before its last. */
export function versionCovers(version: Pick<HabitVersion, "startsOn" | "endsOn">, date: string): boolean {
  return version.startsOn <= date && (version.endsOn === null || version.endsOn >= date);
}

/** The habit's versions running on any day of from..to, oldest first: the prescription those days had. */
export function versionsOver(habit: Pick<ClientHabit, "versions">, from: string, to: string): HabitVersion[] {
  return habit.versions.filter((version) => version.startsOn <= to && (version.endsOn === null || version.endsOn >= from));
}

/** The version covering `date`, or null. A habit's versions never overlap, so there is at most one. */
export function versionOn(habit: Pick<ClientHabit, "versions">, date: string): HabitVersion | null {
  return habit.versions.find((version) => versionCovers(version, date)) ?? null;
}

/** A version done N times a week, on any days; it plans no particular day. */
export function isWeeklyVersion(version: Pick<HabitVersion, "timesPerWeek">): boolean {
  return version.timesPerWeek !== null;
}

/** The habit on `date`: covered, planned, its target, and whether a one-date edit decides it. */
export function habitDay(habit: Pick<ClientHabit, "versions" | "dayEdits">, date: string): HabitDay {
  const version = versionOn(habit, date);
  if (!version) {
    return { date, covered: false, planned: false, target: null, edited: false, versionId: null, timesPerWeek: null };
  }
  if (isWeeklyVersion(version)) {
    return {
      date,
      covered: true,
      planned: false,
      target: version.target,
      edited: false,
      versionId: version.id,
      timesPerWeek: version.timesPerWeek,
    };
  }
  const edit = habit.dayEdits.find((candidate) => candidate.date === date);
  return {
    date,
    covered: true,
    planned: edit ? edit.planned : version.weekdays.includes(weekdayOf(date)),
    target: edit?.target ?? version.target,
    edited: edit !== undefined,
    versionId: version.id,
    timesPerWeek: null,
  };
}

/**
 * Where the habit stands on `today`: running when a version covers the day,
 * upcoming when none does but one starts later — a habit queued to start, or
 * one stopped with a start again queued — else stopped.
 */
export function habitStatus(habit: Pick<ClientHabit, "versions">, today: string): HabitStatus {
  if (versionOn(habit, today)) return "running";
  if (habit.versions.some((version) => version.startsOn > today)) return "upcoming";
  return "stopped";
}

/**
 * The version a habit's words are read from on `day`: the one covering it,
 * else the last to start on or before it (a stopped habit's last), else the
 * first after it (a habit that has not started).
 */
export function versionForWords(habit: Pick<ClientHabit, "versions">, day: string): HabitVersion | null {
  const covering = versionOn(habit, day);
  if (covering) return covering;
  const sorted = [...habit.versions].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  const started = sorted.filter((version) => version.startsOn <= day);
  return started[started.length - 1] ?? sorted[0] ?? null;
}
