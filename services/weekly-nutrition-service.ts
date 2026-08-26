import { supabaseAdmin } from "./supabase-admin"; // system-level upserts + RLS-free reads
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import { calculateWeeklySummaryFromLogs } from "@/utils/weekly-nutrition-helpers";
import { mapNutritionRowToDailyLog, type NutritionRow } from "@/utils/weekly-nutrition-mappers";

const NUTRITION_LOG_SELECT =
  "id, client_id, date, calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g, created_at, updated_at";

/** Computes a nutrition summary for an arbitrary date range from nutrition_logs. */
export async function getNutritionSummaryForPeriod(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<WeeklyNutritionSummary | null> {
  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_logs")
    .select(NUTRITION_LOG_SELECT)
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("Failed to fetch nutrition logs for period summary:", error.message);
    throw new Error("Failed to fetch nutrition logs for period summary");
  }

  if (!rows || rows.length === 0) return null;

  const logs = rows.map(mapNutritionRowToDailyLog);

  const startMs = new Date(startDate + "T00:00:00").getTime();
  const endMs = new Date(endDate + "T00:00:00").getTime();
  const daysInPeriod = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;

  const summary = calculateWeeklySummaryFromLogs(logs, startDate, daysInPeriod, undefined, endDate);

  return {
    ...summary,
    id: "",
    clientId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
