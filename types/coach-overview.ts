/**
 * Data contracts for the coach client Overview. THIS FILE is the contract now —
 * the execution plan that used to hold it shipped and was deleted (its STATUS
 * blocks are in git history). What the page renders and why is documented in
 * `docs/ARCHITECTURE.md` → "Coach client Overview"; the brief/activity types
 * live in `types/coach-brief.ts`.
 */

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
  "dates" | "nutrition" | "habits"
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
 * The Overview progression chart's series: the SAME data the Physique view
 * charts — `check_ins` merged with `client_metric_entries` through the same
 * `buildMetricPoints` tie-break — bounded to the selected window and moved
 * server-side.
 *
 * Transport, not new business logic. The Physique page reaches this data by
 * eagerly paging the client's ENTIRE check-in history, `select("*")` on a
 * 37-column table with four JSON blobs, to read two numbers per row. That is
 * the page's whole job there and fine; on the Overview it would be N sequential
 * fat requests to draw eight dots.
 *
 * Values are canonical kilograms / percent (CONVENTIONS §20). The chart
 * converts at the render boundary.
 */
export type MeasurementSeriesPoint = {
  /** YYYY-MM-DD, ascending. */
  date: string;
  value: number;
};

export type MeasurementSeries = {
  weight: MeasurementSeriesPoint[];
  bodyFat: MeasurementSeriesPoint[];
};

export type ClientNote = {
  id: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
};
