/**
 * Data contracts for the coach client Overview. THIS FILE is the contract now —
 * the execution plan that used to hold it shipped and was deleted (its STATUS
 * blocks are in git history). What the page renders and why is documented in
 * `docs/ARCHITECTURE.md` → "Coach client Overview"; the brief/activity types
 * live in `types/coach-brief.ts`.
 */

import type { MeasurementKey, MeasurementSource } from "@/lib/measurements/keys";
import type { WellnessKey } from "@/lib/wellness/keys";

export type OverviewPlanSummary = {
  training: null | {
    planId: string;
    planName: string;
    splitType: string | null;
    frequencyPerWeek: number | null;
    programDurationWeeks: number | null;
    /** via utils/plan-week.ts; null when today is outside the plan window */
    currentWeek: number | null;
    /** EXACT math of /history/training/summary (training-week-summary-service) */
    thisWeek: { completed: number; planned: number; missed: number };
    nextSession: { name: string; date: string; isToday: boolean } | null;
    /** locked decision 6; null renders as "—" */
    progressionPct: number | null;
  };
  /**
   * A program placed with a future start date. `training` resolves strictly by
   * date, so a program starting tomorrow makes it null — without this field the
   * Overview would tell a coach who just assigned a program that none exists,
   * and invite them to place a second one alongside it.
   *
   * Independent of `training`: a client can be mid-program with another queued
   * behind it. The UI only falls back to this when `training` is null.
   */
  upcomingTraining: null | {
    planId: string;
    planName: string;
    /** effective_from — the program's first day, strictly after client-local today. */
    startsOn: string;
    splitType: string | null;
    frequencyPerWeek: number | null;
    programDurationWeeks: number | null;
  };
  nutrition: null | {
    dietType: string | null;
    customMacros: boolean;
    proteinGPerKg: number | null;
    restDayCalories: number;
    trainDayCalories: number | null;
    surplusPct: number | null;
    restDaysThisWeek: number;
    today: { targetCalories: number; loggedCalories: number | null } | null;
    /**
     * The protein target only. This was a full `macros` triple until the
     * Overview's nutrition card dropped its macro row (2026-08-28); carbs and
     * fat had no reader left. The activation banner still renders protein
     * beside the rest-day calories, which is why this one survives.
     */
    proteinTargetG: number;
  };
};

/** 'none' = no session planned (training rail only) → faint dash */
export type DotState = "complete" | "partial" | "missed" | "no_log" | "none";

/**
 * One habit's window, cut per habit rather than per day.
 *
 * Built from the HABIT list, never from the logs: `logHabit` writes a row only
 * when the client acts, so from the log side "never touched it" and "no such
 * habit" are the same absence — and the habit a coach most needs to see is
 * exactly the one with no rows.
 */
export type HabitBreakdown = {
  id: string;
  name: string;
  /** Days in the window the habit was eligible (`effective_date <= date`). */
  eligibleDays: number;
  completedDays: number;
  /** Completed over ELIGIBLE days; null when the habit was never eligible. */
  pct: number | null;
  /**
   * Index-aligned with `dates`, like every other rail:
   * `true` completed · `false` eligible and not completed · `null` not yet
   * eligible (the habit did not exist yet — not a miss).
   */
  rail: (boolean | null)[];
};

/**
 * What `GET /api/check-in/[id]` carries for the check-in's own reporting period.
 *
 * Training is deliberately absent: the review page derives its training figure
 * from `summariseSessions` (full + partial), and the kernel's is full-only.
 * Both are defensible; both on one screen is not.
 */
export type CheckInPeriodAdherence = Pick<
  AdherenceSummary,
  "dates" | "loggedDates" | "nutrition" | "habits"
>;

export type AdherenceSummary = {
  /**
   * oldest→newest, shared by all rails.
   *
   * The Overview's window ends client-local today; the check-in review's ends
   * on the period the check-in REPORTED on, which is usually in the past
   * (`getClientAdherenceForRange`). Read the length from here rather than
   * recomputing a day count at the call site — the two windows resolve
   * differently on legacy rows, and a denominator that disagrees with `dates`
   * is the defect this contract exists to prevent.
   */
  dates: string[];
  /**
   * The days in `dates` with any log the client made themselves — the derived
   * definition (`loggedDays`, lib/logged-days.ts): a nutrition entry, a
   * wellness reading, a habit log, a workout log or a client-logged
   * measurement. The habits rail reads it for Missed versus No log, and the
   * check-in review's header prints its length over `dates.length`.
   */
  loggedDates: string[];
  training: { rail: DotState[]; completed: number; planned: number; pct: number | null };
  nutrition: { rail: DotState[]; onTarget: number; loggedDays: number; pct: number | null };
  habits: {
    rail: DotState[];
    avgPct: number | null;
    daysBelow50: number;
    perHabit: HabitBreakdown[];
  };
};

/**
 * The client's measurement journey, from the measurement log: every metric's
 * day-values (rule 2 — one value per day, the reading written or edited last), the baseline
 * per metric (the reading as of the start date, derived by the database) and
 * the start date itself. One read serves the Overview progression chart, the
 * Journey's Physique pane and its measurement log.
 *
 * The full history, deliberately: the Journey lists readings dated before the
 * start under "Before start" and excludes them from its chart and maths, so
 * the split by start date is the browser's, which already holds the date.
 *
 * Values are canonical kilograms / centimetres / percent (CONVENTIONS §20).
 * Renderers convert at the boundary.
 */
export type MeasurementSeriesPoint = {
  /** YYYY-MM-DD on the client's calendar, ascending. */
  date: string;
  value: number;
  source: MeasurementSource;
  note: string | null;
  /** The measurement row standing for this day. */
  id: string;
  recordedAt: string;
};

export type MeasurementBaseline = {
  value: number;
  /** The reading's own day — on, before or after the start date. */
  date: string;
  source: MeasurementSource;
  id: string;
};

/**
 * One row of the log as the coach's measurement list shows it — every
 * reading, not the day's standing value: a check-in's 91 kg is listed under
 * the coach's 90 kg logged the same day, and a REMOVED reading stays listed,
 * muted, with who removed it and when. The day-values above are what every
 * figure and the chart read; this list is the only surface that sees a
 * removed row (ARCHITECTURE → "client_measurements table", rule 7).
 */
export type MeasurementReadingEntry = {
  id: string;
  metricKey: MeasurementKey;
  /** YYYY-MM-DD on the client's calendar. */
  date: string;
  value: number;
  source: MeasurementSource;
  /** The check-in stamp a check-in's reading carries; an edit keeps it. */
  sourceId: string | null;
  note: string | null;
  /** When the row was written. */
  recordedAt: string;
  /** When the value was last written or edited: the day's value is the latest
   *  of these, and the log orders a day's readings by it. */
  updatedAt: string;
  measuredAt: string | null;
  /** Set when the reading has been removed; null while it is live. */
  voided: { at: string; byName: string | null; reason: string | null } | null;
};

export type MeasurementSeries = Record<MeasurementKey, MeasurementSeriesPoint[]> & {
  baseline: Partial<Record<MeasurementKey, MeasurementBaseline>>;
  startDate: string | null;
  /** Every reading in the log, newest first, removed ones included. */
  readings: MeasurementReadingEntry[];
};

/**
 * The client's wellness journey for the coach: the five wellness metrics as
 * day-values, one per day, from the client's own daily log
 * (`lib/wellness/day-values.ts` — a wellness score is the client's self-report,
 * so the log is the one source). The whole history, like the measurement
 * series; read by the Journey's Wellness pane
 * (`GET /api/clients/[id]/wellness-series`).
 *
 * Deliberately narrower than `MeasurementSeries`: no `source` and no `note` on
 * a point (one source, and it carries no notes), no `baseline` and no
 * `startDate` (D20 — a mood as of the start date is not a figure a coach
 * reasons about, and the "Before start" split is physique's), no `readings`
 * list (a day holds one row, and nothing is ever removed).
 *
 * Values are the unitless scores the client logged (mood 1-5, the rest 1-10).
 */
export type WellnessSeriesPoint = {
  /** YYYY-MM-DD on the client's calendar, ascending. */
  date: string;
  value: number;
  /** The `wellness_logs` row for that day. */
  id: string;
  /**
   * The row's LAST write — unlike a measurement point's `recordedAt`, which is
   * when an immutable row was written. Same name so both panes' points share
   * one shape downstream; it orders nothing (the series is by `date`).
   */
  recordedAt: string;
};

export type WellnessSeries = Record<WellnessKey, WellnessSeriesPoint[]>;

export type ClientNote = {
  id: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
};
