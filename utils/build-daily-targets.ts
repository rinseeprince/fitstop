import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { DAYS_OF_WEEK, calculateDailyMacros } from "@/utils/nutrition-helpers";
import { getTrainingSessionsSummary } from "@/utils/training-calorie-helpers";
import type { TrainingPlan, TrainingEvent } from "@/types/training";
import type { DietType } from "@/types/check-in";

const DAY_NAMES: Record<number, string> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

/** Get surplus percentage from events for a specific day-of-week. Uses the first event's value. */
function getEventSurplusByDay(events: TrainingEvent[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const event of events) {
    const dayOfWeek = DAY_NAMES[new Date(event.date + "T00:00:00").getDay()];
    if (!(dayOfWeek in result)) {
      result[dayOfWeek] = event.calorieSurplusPercentage ?? null;
    }
  }
  return result;
}

/** Build training session summaries from events, grouped by day-of-week. */
function getEventSessionsSummary(events: TrainingEvent[], day: string): Array<{ name: string; calories: number }> {
  return events
    .filter((e) => DAY_NAMES[new Date(e.date + "T00:00:00").getDay()] === day)
    .map((e) => ({ name: e.sessionName, calories: e.estimatedCalories || 0 }));
}

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
 * Build DailyNutritionTargets[] from stored plan data + live training events.
 * Shared between the coach nutrition API route and the client portal service.
 * Uses percentage surplus model when events have calorieSurplusPercentage set.
 */
export function buildDailyTargetsFromPlan(
  plan: PlanBaseline,
  dailyTargetRows: StoredDailyTarget[] | null,
  trainingPlan: TrainingPlan | null,
  includeActivityBurn: boolean,
  dietType: DietType,
  trainingEvents?: TrainingEvent[]
): DailyNutritionTargets[] {
  const surplusByDay = trainingEvents ? getEventSurplusByDay(trainingEvents) : {};

  const targetsByDay = new Map(
    (dailyTargetRows || []).map((dt) => [dt.day_of_week, dt])
  );

  let dailyTargets: DailyNutritionTargets[] = DAYS_OF_WEEK.map((day) => {
    const stored = targetsByDay.get(day);
    const baselineCalories = stored?.calories ?? plan.baseline_calories;
    const proteinG = stored?.protein_g ?? plan.protein_target_g;
    // Badge must track the live training events for the week, not the stored
    // column on nutrition_plan_daily_targets (which can drift — the sync in
    // regenerateFutureNutritionEvents uses getTrainingDays which returns empty
    // in the current architecture where sessions live on dates, not days).
    // When events are available, use them; otherwise fall back to the column.
    const isTrainingDay = trainingEvents
      ? day in surplusByDay
      : stored?.is_training_day ?? false;

    const trainingSessions = trainingEvents
      ? getEventSessionsSummary(trainingEvents, day)
      : getTrainingSessionsSummary(trainingPlan, day);

    const daySurplus = surplusByDay[day];
    let dayCalories: number;
    let trainingSessionCalories: number;
    let calorieSurplusPercentage: number | null = null;

    if (daySurplus != null) {
      // Percentage model: training day = baseline * (1 + surplus/100)
      calorieSurplusPercentage = daySurplus;
      dayCalories = Math.round(baselineCalories * (1 + daySurplus / 100));
      trainingSessionCalories = dayCalories - baselineCalories;
    } else {
      // Rest day or no events
      trainingSessionCalories = 0;
      dayCalories = baselineCalories;
    }

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
      totalCaloriesWithActivities: dayCalories,
      includeActivityBurn,
      calorieSurplusPercentage,
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
