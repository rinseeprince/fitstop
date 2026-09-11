/**
 * Nutrition Period Summary Generator
 * Pure function that builds a day-by-day nutrition summary from pre-fetched data.
 * No DB calls — receives the logs from schedule-data-service and the targets
 * from the day reader.
 */

import type { DayOfWeek } from "@/types/check-in";
import type { NutritionDay, NutritionDayStatus } from "@/types/schedule";
import type { NutritionLogRow } from "@/services/schedule-data-service";
import type { NutritionDayTarget } from "@/services/nutrition-days-service";
import {
  NUTRITION_ADHERENCE_HIT_THRESHOLD,
  NUTRITION_ADHERENCE_PARTIAL_THRESHOLD,
} from "@/lib/constants";

const DAY_NAMES: Record<number, DayOfWeek> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

function getDayOfWeek(dateStr: string): DayOfWeek {
  return DAY_NAMES[new Date(dateStr + "T00:00:00").getDay()];
}

function classifyAdherence(
  actual: number | null,
  target: number | null
): NutritionDayStatus {
  if (actual === null || actual === undefined) return "not_logged";
  if (target === null || target === undefined) return "not_logged";
  const diff = Math.abs(actual - target);
  if (diff <= NUTRITION_ADHERENCE_HIT_THRESHOLD) return "hit";
  if (diff <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD) return "partial";
  return "missed";
}

/**
 * One row per date: what the client ate from the log, the target from the
 * COMPUTED day for every date, logged or not — the log stores no target — and
 * the verdict derived from the two. A date no version covers has no target
 * and no verdict, whatever was eaten.
 */
export function buildNutritionSummary(
  dates: string[],
  nutritionLogs: NutritionLogRow[],
  targets: ReadonlyMap<string, NutritionDayTarget>
): NutritionDay[] {
  const logsByDate = new Map<string, NutritionLogRow>();
  for (const log of nutritionLogs) {
    logsByDate.set(log.date, log);
  }

  return dates.map((date): NutritionDay => {
    const log = logsByDate.get(date) ?? null;
    const target = targets.get(date) ?? null;
    const actualCalories = log?.caloriesConsumed ?? null;
    const targetCalories = target?.calories ?? null;

    return {
      date,
      dayOfWeek: getDayOfWeek(date),
      status: classifyAdherence(actualCalories, targetCalories),
      targetCalories,
      targetProteinG: target?.proteinG ?? null,
      targetCarbsG: target?.carbsG ?? null,
      targetFatG: target?.fatG ?? null,
      actualCalories,
      actualProteinG: log?.proteinG ?? null,
      actualCarbsG: log?.carbsG ?? null,
      actualFatG: log?.fatG ?? null,
    };
  });
}
