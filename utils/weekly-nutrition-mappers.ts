import type { DailyLog } from "@/types/daily-log";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";

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
