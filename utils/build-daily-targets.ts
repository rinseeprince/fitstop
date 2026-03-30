import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { DAYS_OF_WEEK, calculateDailyMacros, getExternalActivitiesForDay, calculateExternalActivityCalories, getExternalActivitiesSummary } from "@/utils/nutrition-helpers";
import { getTrainingSessionCaloriesByDay, getTrainingSessionsSummary } from "@/utils/training-calorie-helpers";
import type { TrainingPlan } from "@/types/training";
import type { DietType } from "@/types/check-in";

type StoredDailyTarget = {
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  is_training_day: boolean;
};

type PlanBaseline = {
  baseline_calories: number;
  protein_target_g: number;
  carb_target_g: number;
  fat_target_g: number;
};

/**
 * Build DailyNutritionTargets[] from stored plan data + live training plan.
 * Shared between the coach nutrition API route and the client portal service.
 */
export function buildDailyTargetsFromPlan(
  plan: PlanBaseline,
  dailyTargetRows: StoredDailyTarget[] | null,
  trainingPlan: TrainingPlan | null,
  includeActivityBurn: boolean,
  dietType: DietType
): DailyNutritionTargets[] {
  const trainingSessionCaloriesByDay = getTrainingSessionCaloriesByDay(trainingPlan);

  const targetsByDay = new Map(
    (dailyTargetRows || []).map((dt) => [dt.day_of_week, dt])
  );

  let dailyTargets: DailyNutritionTargets[] = DAYS_OF_WEEK.map((day) => {
    const stored = targetsByDay.get(day);
    const baselineCalories = stored?.calories ?? plan.baseline_calories;
    const proteinG = stored?.protein_g ?? plan.protein_target_g;
    const carbG = stored?.carb_g ?? plan.carb_target_g;
    const fatG = stored?.fat_g ?? plan.fat_target_g;
    const isTrainingDay = stored?.is_training_day ?? false;

    const trainingSessionCalories = trainingSessionCaloriesByDay[day] || 0;
    const trainingSessions = getTrainingSessionsSummary(trainingPlan, day);

    const dayActivities = getExternalActivitiesForDay(trainingPlan, day);
    const externalActivityCalories = calculateExternalActivityCalories(dayActivities);
    const externalActivities = getExternalActivitiesSummary(dayActivities);

    const totalActivityCalories = trainingSessionCalories + externalActivityCalories;
    const dayCalories = baselineCalories + totalActivityCalories;

    // Recalculate macros based on total day calories (baseline + training burn)
    // so training days get proportionally more carbs/fat for the surplus
    const macros = calculateDailyMacros(dayCalories, proteinG, isTrainingDay, dietType);
    const totalCal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
    const proteinPercent = totalCal > 0 ? Math.round((macros.proteinG * 4 / totalCal) * 100) : 0;
    const carbsPercent = totalCal > 0 ? Math.round((macros.carbsG * 4 / totalCal) * 100) : 0;

    return {
      day,
      dayLabel: day.charAt(0).toUpperCase() + day.slice(1),
      isTrainingDay,
      calories: dayCalories,
      baselineCalories,
      proteinG: macros.proteinG,
      carbsG: macros.carbsG,
      fatG: macros.fatG,
      proteinPercent,
      carbsPercent,
      fatPercent: 100 - proteinPercent - carbsPercent,
      trainingSessionCalories,
      trainingSessions,
      externalActivityCalories,
      externalActivities,
      totalCaloriesWithActivities: dayCalories,
      includeActivityBurn,
    };
  });

  // When activity burn is excluded, flatten calories to baseline
  if (!includeActivityBurn) {
    dailyTargets = dailyTargets.map((day) => {
      const macros = calculateDailyMacros(
        day.baselineCalories,
        day.proteinG,
        false,
        dietType
      );
      const totalCal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
      const proteinPercent = totalCal > 0 ? Math.round((macros.proteinG * 4 / totalCal) * 100) : 0;
      const carbsPercent = totalCal > 0 ? Math.round((macros.carbsG * 4 / totalCal) * 100) : 0;

      return {
        ...day,
        calories: day.baselineCalories,
        trainingSessionCalories: 0,
        externalActivityCalories: 0,
        totalCaloriesWithActivities: day.baselineCalories,
        proteinG: macros.proteinG,
        carbsG: macros.carbsG,
        fatG: macros.fatG,
        proteinPercent,
        carbsPercent,
        fatPercent: 100 - proteinPercent - carbsPercent,
      };
    });
  }

  return dailyTargets;
}
