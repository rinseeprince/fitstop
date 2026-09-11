/**
 * Schedule Data Service
 * The nutrition-log read that feeds the nutrition period summary — what the
 * client ATE over a period. Used by the check-in snapshot service and the
 * history API; the day's target comes from the day reader
 * (`getNutritionTargetsForDateRange`), never from the log.
 * (The training half — plans with weekday sessions, session logs, training
 * logs — was removed in the 2026-08 dead-code sweep, B5: every consumer read
 * only `.plans`, and post-migration-121 sessions carry `day_of_week: null`.)
 */

import { supabaseAdmin } from "./supabase-admin";

/** One food-log row: what the client ate on the date. */
export type NutritionLogRow = {
  date: string;
  caloriesConsumed: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

export async function fetchNutritionLogsForPeriod(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<NutritionLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_logs")
    .select("date, calories_consumed, protein_g, carbs_g, fat_g")
    .eq("client_id", clientId)
    .gte("date", periodStart)
    .lte("date", periodEnd);

  if (error) throw new Error(`Failed to fetch nutrition logs: ${error.message}`);

  return (data ?? []).map((row) => ({
    date: row.date,
    caloriesConsumed: row.calories_consumed,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
  }));
}
