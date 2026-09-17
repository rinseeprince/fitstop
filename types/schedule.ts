/**
 * Types for day-by-day schedule generation and check-in period snapshots.
 * Used by generators (training-event-helpers, nutrition-period-summary),
 * the snapshot service, AI prompt builder, and history APIs.
 */

import type { DayOfWeek } from "@/types/check-in";

// --- Training schedule types ---

/**
 * ATTENDANCE only — whether the workout was logged, never how it went.
 * `completionQuality` below carries that, off the workout's log, and
 * `isAlternative` says whether the client did a different session.
 *
 * A row written before this vocabulary (a check-in's frozen `period_snapshot`)
 * can carry `partial`, `completed_swap` or `rest_trained`, and its
 * `completionQuality` a `skipped`. Those words are gone from the product, and
 * nothing switches exhaustively on either field, so a frozen row still renders
 * exactly as it was stored.
 */
export type TrainingDayStatus =
  | "scheduled"        // prescribed workout, still to be done
  | "completed"        // the client logged it (at any quality)
  | "missed"           // prescribed workout the day passed without
  | "rest";            // no workout on the day

export type ScheduleDay = {
  date: string;                    // YYYY-MM-DD
  dayOfWeek: DayOfWeek;            // lowercase e.g. "monday"
  status: TrainingDayStatus;
  plannedSessionId: string | null;
  plannedSessionName: string | null;
  loggedSessionName: string | null;
  /** How the workout went, off its log. Null when it was not logged. */
  completionQuality: "full" | "partial" | null;
  isAlternative: boolean;
  notes: string | null;
  sessionLogId: string | null;
};

// --- Nutrition summary types ---

/**
 * A day's standing in the nutrition kernel (`utils/nutrition-period-summary.ts`).
 * `no_target` outranks the rest: a day the coach prescribed nothing for has
 * nothing to judge, logged or not — it is in no ratio.
 */
export type NutritionDayStatus = "hit" | "partial" | "missed" | "not_logged" | "no_target";

export type NutritionDay = {
  date: string;                    // YYYY-MM-DD
  dayOfWeek: DayOfWeek;            // lowercase
  status: NutritionDayStatus;
  targetCalories: number | null;
  targetProteinG: number | null;
  targetCarbsG: number | null;
  targetFatG: number | null;
  actualCalories: number | null;
  actualProteinG: number | null;
  actualCarbsG: number | null;
  actualFatG: number | null;
};

// --- Period snapshot (frozen at check-in submission) ---

export type PeriodSnapshot = {
  generatedAt: string;             // ISO timestamp
  training: ScheduleDay[];
  nutrition: NutritionDay[];
};
