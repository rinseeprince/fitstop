import type { NutritionEvent } from "@/types/check-in";
import type { DailyNutritionTargets, DayOfWeek } from "@/utils/nutrition-helpers";
import { applySurplusSplit } from "@/utils/nutrition-helpers";

/**
 * Get total calories for a nutrition event, with its version's "Apply training
 * day surplus" setting. New model: percentage surplus. Legacy model: flat burn
 * addition.
 */
function getTotalCalories(event: NutritionEvent): number {
  if (!event.includeActivityBurn) return event.baselineCalories;

  // New percentage model: training day total = baseline * (1 + surplus/100)
  if (event.calorieSurplusPercentage != null) {
    return Math.round(event.baselineCalories * (1 + event.calorieSurplusPercentage / 100));
  }

  // Legacy flat burn model
  return event.baselineCalories + event.trainingBurnCalories;
}

/**
 * Map a NutritionEvent to the DailyNutritionTargets display type, priced with
 * the two surplus settings the day carries — its covering version's (migration
 * 196), so a later save never re-prices it.
 *
 * The macros the coach SET are what display. They are shown verbatim when burn
 * is off, the day is frozen (is_modified), or there's no training surplus to add
 * (rest days, flat custom plans). Only a real training-day surplus changes them,
 * and even then protein is held at the set grams; `surplusAsCarbs` decides where
 * the extra calories go:
 *   - false (default, "keep my split"): carbs + fat scale to the higher total
 *     PRESERVING their stored ratio — the coach's split is honored, never
 *     re-derived from the diet type (keto stays keto). For auto plans the stored
 *     ratio already IS the diet split, so this is a no-op there.
 *   - true ("carbs only"): fat is ALSO held; the whole surplus is added as carbs.
 */
export function mapNutritionEventToDisplayTarget(event: NutritionEvent): DailyNutritionTargets {
  const dayOfWeek = event.dayOfWeek as DayOfWeek;
  const dayLabel = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);

  const totalCalories = getTotalCalories(event);
  const surplusCalories = totalCalories - event.baselineCalories;

  if (!event.includeActivityBurn || event.isModified || surplusCalories <= 0) {
    const totalCal = event.proteinG * 4 + event.carbG * 4 + event.fatG * 9;
    const proteinPercent = totalCal > 0 ? Math.round((event.proteinG * 4 / totalCal) * 100) : 0;
    const carbsPercent = totalCal > 0 ? Math.round((event.carbG * 4 / totalCal) * 100) : 0;

    return {
      day: dayOfWeek,
      dayLabel,
      isTrainingDay: event.isTrainingDay,
      calories: event.baselineCalories,
      baselineCalories: event.baselineCalories,
      proteinG: event.proteinG,
      carbsG: event.carbG,
      fatG: event.fatG,
      proteinPercent,
      carbsPercent,
      fatPercent: 100 - proteinPercent - carbsPercent,
      trainingSessionCalories: 0,
      trainingSessions: [],
      totalCaloriesWithActivities: event.baselineCalories,
      includeActivityBurn: false,
      calorieSurplusPercentage: event.calorieSurplusPercentage,
    };
  }

  // A real training surplus applies. Protein is always held; the surplus mode
  // decides the rest (shared with the plan-template path via applySurplusSplit).
  const proteinG = event.proteinG;
  const { carbsG, fatG } = applySurplusSplit(
    totalCalories,
    proteinG,
    event.carbG,
    event.fatG,
    event.surplusAsCarbs
  );

  const totalCal = proteinG * 4 + carbsG * 4 + fatG * 9;
  const proteinPercent = totalCal > 0 ? Math.round((proteinG * 4 / totalCal) * 100) : 0;
  const carbsPercent = totalCal > 0 ? Math.round((carbsG * 4 / totalCal) * 100) : 0;

  return {
    day: dayOfWeek,
    dayLabel,
    isTrainingDay: event.isTrainingDay,
    calories: totalCalories,
    baselineCalories: event.baselineCalories,
    proteinG,
    carbsG,
    fatG,
    proteinPercent,
    carbsPercent,
    fatPercent: 100 - proteinPercent - carbsPercent,
    trainingSessionCalories: surplusCalories,
    trainingSessions: [],
    totalCaloriesWithActivities: totalCalories,
    includeActivityBurn: true,
    calorieSurplusPercentage: event.calorieSurplusPercentage,
  };
}
