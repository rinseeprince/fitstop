import type { DailyLog } from "@/types/daily-log";
import type { WeeklyNutritionSummary, WeeklyAdherenceStatus } from "@/types/weekly-nutrition";
import { getWeekEnd } from "@/lib/date-helpers";
import {
  WEEKLY_NUTRITION_HIT_PER_DAY,
  WEEKLY_NUTRITION_PARTIAL_PER_DAY,
  NUTRITION_ADHERENCE_HIT_THRESHOLD,
} from "@/lib/constants";

/** Override targets for the full week (logged days + plan-based unlogged days) */
export type FullWeekTargets = {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

/**
 * Pure function: calculates a weekly nutrition summary from daily logs.
 * No DB access — testable in isolation.
 */
export function calculateWeeklySummaryFromLogs(
  logs: DailyLog[],
  weekStartDate: string,
  daysInWeek = 7,
  fullWeekTargets?: FullWeekTargets,
  weekEndDateOverride?: string
): Omit<WeeklyNutritionSummary, "id" | "clientId" | "createdAt" | "updatedAt"> {
  const weekEndDate = weekEndDateOverride ?? getWeekEnd(weekStartDate);

  let totalCaloriesConsumed = 0;
  let totalTargetCalories = 0;
  let totalProteinConsumed = 0;
  let totalTargetProtein = 0;
  let totalCarbsConsumed = 0;
  let totalTargetCarbs = 0;
  let totalFatConsumed = 0;
  let totalTargetFat = 0;

  let daysLogged = 0;
  let daysOnTarget = 0;
  let daysOver = 0;
  let daysUnder = 0;

  let hasAnyTargets = false;
  let hasAnyConsumed = false;

  for (const log of logs) {
    const consumed = log.caloriesConsumed;
    const target = log.targetCalories;

    if (consumed != null) {
      hasAnyConsumed = true;
      daysLogged++;
      totalCaloriesConsumed += consumed;
      totalProteinConsumed += log.proteinG ?? 0;
      totalCarbsConsumed += log.carbsG ?? 0;
      totalFatConsumed += log.fatG ?? 0;
    }

    if (target != null) {
      hasAnyTargets = true;
      totalTargetCalories += target;
      totalTargetProtein += log.targetProteinG ?? 0;
      totalTargetCarbs += log.targetCarbsG ?? 0;
      totalTargetFat += log.targetFatG ?? 0;
    }

    // Day-level classification (only if both consumed and target exist)
    if (consumed != null && target != null) {
      const diff = consumed - target;
      if (Math.abs(diff) <= NUTRITION_ADHERENCE_HIT_THRESHOLD) {
        daysOnTarget++;
      } else if (diff > 0) {
        daysOver++;
      } else {
        daysUnder++;
      }
    }
  }

  // Use full-week targets when provided (logged days + plan-based unlogged days),
  // otherwise fall back to log-derived targets only
  const effectiveTargetCal = fullWeekTargets ? fullWeekTargets.calories : totalTargetCalories;
  const effectiveTargetProtein = fullWeekTargets ? fullWeekTargets.proteinG : totalTargetProtein;
  const effectiveTargetCarbs = fullWeekTargets ? fullWeekTargets.carbsG : totalTargetCarbs;
  const effectiveTargetFat = fullWeekTargets ? fullWeekTargets.fatG : totalTargetFat;
  const effectiveHasTargets = fullWeekTargets ? effectiveTargetCal > 0 : hasAnyTargets;

  const calorieDifference =
    hasAnyConsumed && effectiveHasTargets
      ? totalCaloriesConsumed - effectiveTargetCal
      : null;

  const adherencePercentage =
    hasAnyConsumed && effectiveHasTargets && effectiveTargetCal > 0
      ? Math.round((totalCaloriesConsumed / effectiveTargetCal) * 1000) / 10
      : null;

  const weeklyAdherence = calculateWeeklyAdherence(calorieDifference, daysInWeek);

  return {
    weekStartDate,
    weekEndDate,
    totalTargetCalories: effectiveHasTargets ? effectiveTargetCal : 0,
    totalTargetProteinG: effectiveHasTargets ? effectiveTargetProtein : null,
    totalTargetCarbsG: effectiveHasTargets ? effectiveTargetCarbs : null,
    totalTargetFatG: effectiveHasTargets ? effectiveTargetFat : null,
    totalCaloriesConsumed: hasAnyConsumed ? totalCaloriesConsumed : null,
    totalProteinConsumedG: hasAnyConsumed ? totalProteinConsumed : null,
    totalCarbsConsumedG: hasAnyConsumed ? totalCarbsConsumed : null,
    totalFatConsumedG: hasAnyConsumed ? totalFatConsumed : null,
    calorieDifference,
    adherencePercentage,
    weeklyAdherence,
    daysInWeek,
    daysLogged,
    daysOnTarget,
    daysOver,
    daysUnder,
  };
}

/**
 * Applies scaled weekly adherence thresholds.
 * Thresholds scale with days_in_week for partial weeks.
 */
export function calculateWeeklyAdherence(
  calorieDifference: number | null,
  daysInWeek: number
): WeeklyAdherenceStatus | null {
  if (calorieDifference == null) return null;

  const absDiff = Math.abs(calorieDifference);
  const hitThreshold = WEEKLY_NUTRITION_HIT_PER_DAY * daysInWeek;
  const partialThreshold = WEEKLY_NUTRITION_PARTIAL_PER_DAY * daysInWeek;

  if (absDiff <= hitThreshold) return "hit";
  if (absDiff <= partialThreshold) return "partial";
  return "missed";
}
