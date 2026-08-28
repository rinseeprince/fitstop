/**
 * Data contracts for the redesigned coach client Overview (Session 1 of
 * docs/OVERVIEW-REDESIGN-EXECUTION-PLAN.md — binding; record any drift in the
 * STATUS block). The brief/activity types live in types/coach-brief.ts.
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
    macros: { proteinG: number; carbG: number; fatG: number };
  };
};

/** 'none' = no session planned (training rail only) → faint dash */
export type DotState = "complete" | "partial" | "missed" | "no_log" | "none";

/**
 * A window's mean intake against the mean target that applied over the SAME
 * days. Null when no day in the window recorded both.
 *
 * `days` is deliberately its own number rather than reusing `loggedDays`:
 * `nutrition_logs` snapshots the target per row, but a day logged before a plan
 * existed carries a null target, so the days behind this mean are a subset of
 * the days the client logged. A panel that showed this average under a
 * "9 days logged" heading would be quietly comparing different day sets.
 */
export type NutritionAverage = {
  actual: number;
  target: number;
  days: number;
} | null;

/**
 * One habit's window, for the Signals card's habits detail.
 *
 * It rides on the adherence summary rather than on `/habits/logs` because a
 * habit the client never touched in the window has **no log rows at all**
 * (`logHabit` upserts only when they act), so a grid built from logs silently
 * omits exactly the habit that most needs looking at. The adherence read
 * already selects the active habits AND their logs for this window, so the
 * roster is free here and complete — the same "more columns, same query" move
 * the nutrition means made.
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

export type AdherenceSummary = {
  /** oldest→newest, shared by all rails; window ends client-local today */
  dates: string[];
  training: { rail: DotState[]; completed: number; planned: number; pct: number | null };
  nutrition: {
    rail: DotState[];
    onTarget: number;
    loggedDays: number;
    pct: number | null;
    /**
     * Window means, for the Signals card's nutrition detail. Both come from
     * `nutrition_logs` columns the adherence read already selects, so the
     * target is the one that applied ON that day rather than today's plan.
     */
    calories: NutritionAverage;
    protein: NutritionAverage;
  };
  habits: {
    rail: DotState[];
    avgPct: number | null;
    daysBelow50: number;
    /** Per-habit breakdown, in the client's habit order. */
    perHabit: HabitBreakdown[];
  };
};

export type ClientNote = {
  id: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
};
