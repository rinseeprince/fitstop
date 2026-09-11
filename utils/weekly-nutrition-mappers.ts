import type { DailyLog } from "@/types/daily-log";
import type { NutritionDayTarget } from "@/services/nutrition-days-service";
import {
  calculateCalorieSurplusDeficit,
  calculateNutritionAdherence,
} from "@/services/daily-logs-service";

/** Shape of a row from the nutrition_logs table (select subset): what the client ate. */
export type NutritionRow = {
  id: string;
  client_id: string;
  date: string;
  calories_consumed: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * Maps a raw nutrition_logs row to a DailyLog domain object. The row supplies
 * what the client ate; the day's target is the COMPUTED day the caller looked
 * up for the date (`getNutritionTargetsForDateRange`), and the verdict is
 * derived from the two here — the log stores no target and no verdict.
 */
export function mapNutritionRowToDailyLog(
  r: NutritionRow,
  target: NutritionDayTarget | null
): DailyLog {
  const consumed = r.calories_consumed ?? undefined;
  return {
    id: r.id,
    clientId: r.client_id,
    date: r.date,
    caloriesConsumed: consumed,
    proteinG: r.protein_g ?? undefined,
    carbsG: r.carbs_g ?? undefined,
    fatG: r.fat_g ?? undefined,
    targetCalories: target?.calories,
    targetProteinG: target?.proteinG,
    targetCarbsG: target?.carbsG,
    targetFatG: target?.fatG,
    nutritionAdherence: calculateNutritionAdherence(consumed, target?.calories) ?? undefined,
    calorieSurplusDeficit: calculateCalorieSurplusDeficit(consumed, target?.calories) ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
