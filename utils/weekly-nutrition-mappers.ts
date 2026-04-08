import type { DailyLog } from "@/types/daily-log";
import type { WeeklyNutritionSummary, WeeklyAdherenceStatus } from "@/types/weekly-nutrition";
import type { Database } from "@/types/database";

/** Shape of a row from the nutrition_logs table (select subset). */
export type NutritionRow = {
  id: string;
  client_id: string;
  date: string;
  calories_consumed: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  created_at: string;
  updated_at: string;
};

/** Maps a raw nutrition_logs row to a DailyLog domain object. */
export function mapNutritionRowToDailyLog(r: NutritionRow): DailyLog {
  return {
    id: r.id,
    clientId: r.client_id,
    date: r.date,
    caloriesConsumed: r.calories_consumed ?? undefined,
    proteinG: r.protein_g ?? undefined,
    carbsG: r.carbs_g ?? undefined,
    fatG: r.fat_g ?? undefined,
    targetCalories: r.target_calories ?? undefined,
    targetProteinG: r.target_protein_g ?? undefined,
    targetCarbsG: r.target_carbs_g ?? undefined,
    targetFatG: r.target_fat_g ?? undefined,
    nutritionAdherence: undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type NWSRow = Database["public"]["Tables"]["nutrition_weekly_summaries"]["Row"];

/** Maps a nutrition_weekly_summaries DB row to a WeeklyNutritionSummary. */
export function mapRowToSummary(row: NWSRow): WeeklyNutritionSummary {
  return {
    id: row.id,
    clientId: row.client_id,
    weekStartDate: row.week_start_date,
    weekEndDate: row.week_end_date ?? row.week_start_date,
    totalTargetCalories: row.weekly_calorie_target,
    totalTargetProteinG: row.weekly_protein_target_g,
    totalTargetCarbsG: row.weekly_carbs_target_g,
    totalTargetFatG: row.weekly_fat_target_g,
    totalCaloriesConsumed: row.total_calories_consumed,
    totalProteinConsumedG: row.total_protein_consumed_g,
    totalCarbsConsumedG: row.total_carbs_consumed_g,
    totalFatConsumedG: row.total_fat_consumed_g,
    calorieDifference: row.calorie_difference,
    adherencePercentage: row.adherence_percentage,
    weeklyAdherence: row.weekly_adherence as WeeklyAdherenceStatus | null,
    daysInWeek: row.total_days ?? 7,
    daysLogged: row.days_logged ?? 0,
    daysOnTarget: row.days_on_target ?? 0,
    daysOver: row.days_over ?? 0,
    daysUnder: row.days_under ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
