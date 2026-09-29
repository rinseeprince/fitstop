import type { DayOfWeek } from "@/types/check-in";

/**
 * A client's habits (migration 203; docs/HABITS-REBUILD-PLAN.md §2). A habit is
 * its identity; its prescription is its versions, runs of days each with a
 * target and days; a one-date edit changes one day of a set-days habit; an
 * entry is the client's answer for one day. Whether an entry is met, and every
 * figure a week or a day has, is worked out by the kernel in `lib/habits/` —
 * none of it is stored.
 */

/** How a habit is measured, for life: a tick, or a number against a target. */
export type HabitMeasure = "tick" | "number";

/** Which side of its target a number habit wants: water, steps, sleep; drinks, screen time. */
export type HabitDirection = "at_least" | "at_most";

/** A run of days with its target and its days (`client_habit_versions`). */
export type HabitVersion = {
  id: string;
  startsOn: string;
  /** Its last day; null: it runs on. */
  endsOn: string | null;
  /** A number habit's target, in its unit; null on a tick habit. */
  target: number | null;
  /** N times a week, on any days; null: the weekdays below. */
  timesPerWeek: number | null;
  /** The days a set-days version is planned on, Monday first; every day is all seven; empty on a weekly version. */
  weekdays: DayOfWeek[];
};

/** The coach's change to one date of a set-days habit (`client_habit_day_edits`). */
export type HabitDayEdit = {
  date: string;
  planned: boolean;
  /** That day's target; null: the version's. */
  target: number | null;
};

/** What a habit is: the identity every habit wire carries. */
export type HabitIdentity = {
  id: string;
  name: string;
  /** Shown to the client. */
  howTo: string | null;
  measure: HabitMeasure;
  /** A number habit's unit, the coach's word, never converted. */
  unit: string | null;
  /** A number habit's; null on a tick habit. */
  direction: HabitDirection | null;
};

/** A habit with its prescription: every version, oldest first, and its one-date edits over the days read. */
export type ClientHabit = HabitIdentity & {
  position: number;
  versions: HabitVersion[];
  dayEdits: HabitDayEdit[];
};

/** The client's entry for one habit on one day: done or not, or a number, and a note. */
export type HabitEntry = {
  habitId: string;
  date: string;
  done: boolean | null;
  value: number | null;
  note: string | null;
};

/** The client's answer for a day: a tick habit's done or not, a number habit's number. */
export type HabitAnswer = { done: boolean } | { value: number };

/** A habit on one date: whether a version covers it, whether it is planned, and its target. */
export type HabitDay = {
  date: string;
  /** A version covers the day: the client may make an entry on it. */
  covered: boolean;
  /** A set-days version plans the day, or a one-date edit puts it on. A weekly version plans no day. */
  planned: boolean;
  /** A number habit's target that day: the one-date edit's, else the version's. */
  target: number | null;
  /** A one-date edit decides the day. */
  edited: boolean;
  versionId: string | null;
  /**
   * The covering version's N when it is done N times a week — a habit for any
   * day of the week, which plans none — else null (set days, or no version).
   */
  timesPerWeek: number | null;
};

/** A day as it happened: the habit's day, the entry on it, and whether that entry met the day's target. */
export type HabitDayFacts = HabitDay & {
  entry: Pick<HabitEntry, "done" | "value" | "note"> | null;
  /** The day holds a met entry and a version covers it. */
  met: boolean;
};

/**
 * A habit's week (rule 6): `planned` is its planned days plus, for a weekly
 * version, its N capped at the days it covers that week; `done` the days
 * holding a met entry; `met` is done up to planned, so a day made up counts
 * toward its week and no further.
 */
export type HabitWeekFigures = { planned: number; done: number; met: number };

/** A habit's week over its dates: each day as it happened, and the week's figures. */
export type HabitWeek = { days: HabitDayFacts[]; figures: HabitWeekFigures };

/** One day of a range, judged by its own planned habits alone: how many were planned, how many done that day. */
export type HabitDayTally = { date: string; planned: number; done: number };

/** The words a habit is described in on every screen. */
export type HabitWords = {
  /** "Every day", "Mon, Wed, Fri", "3 times a week"; null when the habit has no version to read. */
  schedule: string | null;
  /** "at least 3 L", "at most 2 drinks"; null on a tick habit. */
  target: string | null;
};

/** A week's figures and the days it runs. */
export type HabitWeekSpan = HabitWeekFigures & { start: string; end: string };

/** A habit over a week's dates: each day as it happened, the week's figures and its words. */
export type HabitWeekRow = {
  habit: HabitIdentity;
  words: HabitWords;
  days: HabitDayFacts[];
  figures: HabitWeekFigures;
};

/** `GET /api/clients/[id]/habits/week`: the coach's week tracker and summary. */
export type CoachHabitWeek = {
  clientToday: string;
  start: string;
  end: string;
  dates: string[];
  /** Every habit a version covers on one of the week's days, in the client's order. */
  habits: HabitWeekRow[];
  totals: HabitWeekFigures;
  /** Today's planned habits and how many were done today; null when today is not in the week. */
  today: { planned: number; done: number } | null;
};

/** `GET /api/client/habits/week`: the habit week over dates inside one client week. */
export type ClientHabitWeek = {
  start: string;
  end: string;
  dates: string[];
  habits: HabitWeekRow[];
  totals: HabitWeekFigures;
};

/** One habit a version covers on the date, as `GET /api/client/habits/day` gives it. */
export type ClientHabitDayItem = {
  habit: HabitIdentity;
  day: HabitDayFacts;
  /** The client week holding the date. */
  week: HabitWeekSpan;
  /** The day's words — its target is the day's — and the week's figure in words ("2 of 3"). */
  words: HabitWords & { week: string };
};

/** `GET /api/client/habits/day`. */
export type ClientHabitDay = { date: string; habits: ClientHabitDayItem[] };

/** The entry routes' answer: the habit's day and its week, as they stand after the write. */
export type HabitEntryResult = { day: HabitDayFacts; week: HabitWeekSpan };

/** One habit on the Journey: its recent weeks' figures and its last days as they happened. */
export type HabitProgressRow = {
  habit: HabitIdentity;
  words: HabitWords;
  /** The client weeks, oldest first, the last holding today. */
  weeks: HabitWeekSpan[];
  /** The days ending today, oldest first. */
  days: HabitDayFacts[];
};

/** `GET /api/client/habits/progress`. */
export type ClientHabitProgress = { clientToday: string; habits: HabitProgressRow[] };

/** A habit the coach has given a client, offered for reuse (`coach_habit_choices`), with its newest version's defaults. */
export type HabitChoice = {
  name: string;
  howTo: string | null;
  measure: HabitMeasure;
  unit: string | null;
  direction: HabitDirection | null;
  target: number | null;
  timesPerWeek: number | null;
  weekdays: DayOfWeek[];
  words: HabitWords;
};
