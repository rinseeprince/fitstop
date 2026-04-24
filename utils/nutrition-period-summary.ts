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
  TrainingPlanWithSessions,
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

function findActiveTrainingPlan(
  plans: TrainingPlanWithSessions[],
  date: string
): TrainingPlanWithSessions | null {
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

/**
 * For unlogged days, estimate the target by adding the planned training
 * session's estimated calories to the plan baseline.
 * External activity burn is excluded (only known at log time).
 */
function estimateTargetForUnloggedDay(
  baseCalories: number | null,
  dayOfWeek: string,
  trainingPlans: TrainingPlanWithSessions[],
  date: string
): number | null {
  if (baseCalories === null) return null;
  const plan = findActiveTrainingPlan(trainingPlans, date);
  if (!plan) return baseCalories;

  const session = plan.sessions.find(
    (s) => s.dayOfWeek?.toLowerCase() === dayOfWeek
  );
  const burn = session?.estimatedCalories;
  return burn ? baseCalories + burn : baseCalories;
}

export function buildNutritionSummary(
  dates: string[],
  plans: NutritionPlanWithTargets[],
  nutritionLogs: NutritionLogRow[],
  trainingPlans?: TrainingPlanWithSessions[],
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
    // For unlogged days: use plan baseline + planned session burn estimate
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
        // Fallback: no event for this date (pre-backfill data), estimate from template
        targetCalories = trainingPlans
          ? estimateTargetForUnloggedDay(planTarget?.calories ?? null, dayOfWeek, trainingPlans, date)
          : planTarget?.calories ?? null;
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
