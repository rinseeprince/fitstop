import type { NutritionEvent } from "@/types/check-in";
import type { DietType } from "@/types/check-in";
import type { DailyNutritionTargets, DayOfWeek } from "@/utils/nutrition-helpers";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";

/**
 * Get total calories for a nutrition event, respecting the activity burn toggle.
 */
export function getTotalCalories(
  event: NutritionEvent,
  includeActivityBurn: boolean
): number {
  if (!includeActivityBurn) return event.baselineCalories;
  return event.baselineCalories + event.trainingBurnCalories + event.externalBurnCalories;
}

/**
 * Map a NutritionEvent to the DailyNutritionTargets display type.
 *
 * When includeActivityBurn is false: uses stored baseline macros directly.
 * When includeActivityBurn is true: recalculates macros from total calories
 * using the event's snapshotted dietType so carb/fat split is correct for
 * the higher calorie total.
 */
export function mapNutritionEventToDisplayTarget(
  event: NutritionEvent,
  includeActivityBurn: boolean
): DailyNutritionTargets {
  const dayOfWeek = event.dayOfWeek as DayOfWeek;
  const dayLabel = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);

  if (!includeActivityBurn) {
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
      externalActivityCalories: 0,
      externalActivities: [],
      totalCaloriesWithActivities: event.baselineCalories,
      includeActivityBurn: false,
    };
  }

  // Recalculate macros for total calories (baseline + burns)
  const totalCalories = event.baselineCalories + event.trainingBurnCalories + event.externalBurnCalories;
  const macros = calculateDailyMacros(
    totalCalories,
    event.proteinG,
    event.isTrainingDay,
    (event.dietType as DietType) || "balanced"
  );

  const totalCal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
  const proteinPercent = totalCal > 0 ? Math.round((macros.proteinG * 4 / totalCal) * 100) : 0;
  const carbsPercent = totalCal > 0 ? Math.round((macros.carbsG * 4 / totalCal) * 100) : 0;

  return {
    day: dayOfWeek,
    dayLabel,
    isTrainingDay: event.isTrainingDay,
    calories: totalCalories,
    baselineCalories: event.baselineCalories,
    proteinG: macros.proteinG,
    carbsG: macros.carbsG,
    fatG: macros.fatG,
    proteinPercent,
    carbsPercent,
    fatPercent: 100 - proteinPercent - carbsPercent,
    trainingSessionCalories: event.trainingBurnCalories,
    trainingSessions: [],
    externalActivityCalories: event.externalBurnCalories,
    externalActivities: [],
    totalCaloriesWithActivities: totalCalories,
    includeActivityBurn: true,
  };
}
