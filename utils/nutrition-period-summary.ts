/**
 * Nutrition Period Summary Generator
 * Pure function that builds a day-by-day nutrition summary from pre-fetched data.
 * No DB calls — receives data from schedule-data-service.
 */

import type { DayOfWeek, NutritionEvent } from "@/types/check-in";
import type { NutritionDay, NutritionDayStatus } from "@/types/schedule";
import type {
  NutritionPlanWithTargets,
  NutritionLogRow,
} from "@/services/schedule-data-service";
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

function findActiveNutritionPlan(
  plans: NutritionPlanWithTargets[],
  date: string
): NutritionPlanWithTargets | null {
  return plans.find((p) =>
    p.effectiveFrom <= date &&
    (p.effectiveUntil === null || p.effectiveUntil >= date)
  ) ?? null;
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

export function buildNutritionSummary(
  dates: string[],
  plans: NutritionPlanWithTargets[],
  nutritionLogs: NutritionLogRow[],
  nutritionEvents?: NutritionEvent[]
): NutritionDay[] {
  // Build lookup maps for O(1) access per date
  const logsByDate = new Map<string, NutritionLogRow>();
  for (const log of nutritionLogs) {
    logsByDate.set(log.date, log);
  }

  const eventsByDate = new Map<string, NutritionEvent>();
  if (nutritionEvents) {
    for (const event of nutritionEvents) {
      eventsByDate.set(event.date.split("T")[0], event);
    }
  }

  return dates.map((date): NutritionDay => {
    const dayOfWeek = getDayOfWeek(date);
    const plan = findActiveNutritionPlan(plans, date);

    // Find plan baseline target for this day of week
    const planTarget = plan?.dailyTargets.find(
      (t) => t.dayOfWeek.toLowerCase() === dayOfWeek
    ) ?? null;

    // Find nutrition log for this date
    const log = logsByDate.get(date) ?? null;
    const actualCalories = log?.caloriesConsumed ?? null;

    // For logged days: use stored target (includes activity burn computed at log time)
    // For unlogged days: the nutrition event, else the plan's weekday template
    let targetCalories: number | null;
    let targetProteinG: number | null;
    let targetCarbsG: number | null;
    let targetFatG: number | null;

    if (log && log.targetCalories != null) {
      // Logged day — stored target is authoritative
      targetCalories = log.targetCalories;
      targetProteinG = log.targetProteinG ?? planTarget?.proteinG ?? null;
      targetCarbsG = log.targetCarbsG ?? planTarget?.carbG ?? null;
      targetFatG = log.targetFatG ?? planTarget?.fatG ?? null;
    } else {
      // Unlogged day — prefer nutrition event (percentage surplus or legacy burns)
      const event = eventsByDate.get(date);
      if (event) {
        targetCalories = event.calorieSurplusPercentage != null
          ? Math.round(event.baselineCalories * (1 + event.calorieSurplusPercentage / 100))
          : event.baselineCalories + event.trainingBurnCalories;
        targetProteinG = event.proteinG;
        targetCarbsG = event.carbG;
        targetFatG = event.fatG;
      } else {
        // Fallback: no event for this date (pre-backfill data) — the plan's
        // weekday template. (A planned-session burn estimate used to be added
        // here off `training_sessions.day_of_week`; post-migration-121 rows
        // carry null there, so it always resolved to the template — removed.)
        targetCalories = planTarget?.calories ?? null;
        targetProteinG = planTarget?.proteinG ?? null;
        targetCarbsG = planTarget?.carbG ?? null;
        targetFatG = planTarget?.fatG ?? null;
      }
    }

    return {
      date,
      dayOfWeek,
      status: classifyAdherence(actualCalories, targetCalories),
      targetCalories,
      targetProteinG,
      targetCarbsG,
      targetFatG,
      actualCalories,
      actualProteinG: log?.proteinG ?? null,
      actualCarbsG: log?.carbsG ?? null,
      actualFatG: log?.fatG ?? null,
    };
  });
}
