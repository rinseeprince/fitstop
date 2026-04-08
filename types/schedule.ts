/**
 * Types for day-by-day schedule generation and check-in period snapshots.
 * Used by generators (training-event-helpers, nutrition-period-summary),
 * the snapshot service, AI prompt builder, and history APIs.
 */

import type { DayOfWeek } from "@/types/check-in";

// --- Training schedule types ---

export type TrainingDayStatus =
  | "completed"        // prescribed session done as planned
  | "completed_swap"   // prescribed session existed, client did a different one
  | "partial"          // prescribed session partially done
  | "missed"           // prescribed session not logged
  | "rest"             // rest day, no training
  | "rest_trained";    // rest day, but client trained anyway

export type ScheduleDay = {
  date: string;                    // YYYY-MM-DD
  dayOfWeek: DayOfWeek;            // lowercase e.g. "monday"
  status: TrainingDayStatus;
  plannedSessionId: string | null;
  plannedSessionName: string | null;
  loggedSessionName: string | null;
  completionQuality: "full" | "partial" | "skipped" | null;
  isAlternative: boolean;
  notes: string | null;
};

// --- Nutrition summary types ---

export type NutritionDayStatus = "hit" | "partial" | "missed" | "not_logged";

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
