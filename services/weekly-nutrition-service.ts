import { supabaseAdmin } from "./supabase-admin"; // system-level upserts + RLS-free reads
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import {
  calculateWeeklySummaryFromLogs,
  type FullWeekTargets,
} from "@/utils/weekly-nutrition-helpers";
import { mapNutritionRowToDailyLog, type NutritionRow } from "@/utils/weekly-nutrition-mappers";
import { fetchNutritionDataForPeriod } from "./schedule-data-service";
import { getNutritionEventsForDateRange } from "./nutrition-event-service";
import { buildNutritionSummary } from "@/utils/nutrition-period-summary";
import { addDaysToDateString } from "@/lib/date-helpers";

const NUTRITION_LOG_SELECT =
  "id, client_id, date, calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g, created_at, updated_at";

/**
 * What the client was SUPPOSED to eat across the whole period — every day of
 * it, not just the days they logged.
 *
 * This is the denominator half of #5. Summing only the logged days' targets
 * makes a client who logged three of seven perfect days read 100% adherent:
 * the three days they skipped contribute to neither side of the ratio, so the
 * week they mostly ignored scores the same as a week they nailed.
 *
 * `buildNutritionSummary` already resolves each day's target with the right
 * precedence — a logged day's frozen target (it includes the activity burn
 * computed at log time), else that date's nutrition event, else the plan's
 * weekday template — so this is a sum over its output, not a fourth spelling
 * of the same resolution. `null` when the period has no targets at all: the
 * caller then falls back to the logged-days total, which is what it did for
 * every call before this.
 */
async function buildFullWeekTargets(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<FullWeekTargets | null> {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDaysToDateString(date, 1)) {
    dates.push(date);
  }

  const [{ plans, nutritionLogs }, events] = await Promise.all([
    fetchNutritionDataForPeriod(clientId, startDate, endDate),
    getNutritionEventsForDateRange(clientId, startDate, endDate),
  ]);

  const days = buildNutritionSummary(dates, plans, nutritionLogs, events);

  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const day of days) {
    calories += day.targetCalories ?? 0;
    proteinG += day.targetProteinG ?? 0;
    carbsG += day.targetCarbsG ?? 0;
    fatG += day.targetFatG ?? 0;
  }

  if (calories <= 0) return null;
  return { calories, proteinG, carbsG, fatG };
}

/**
 * Computes a nutrition summary for an arbitrary date range from nutrition_logs,
 * against the WHOLE period's targets.
 *
 * The one place three paths agree on this number: the coach submit path's
 * stored `adherence_percentage` / `nutrition_days_on_target`
 * (`check-in-service`), the client submit path's AI prompt
 * (`client-check-in-service`), and the coach's Regenerate
 * (`/api/check-in/[id]/ai-summary`). Changing the denominator here moves all
 * three together, which is the point — they were never meant to disagree.
 */
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

  // Whole-period targets, not the logged days' own. `null` keeps the previous
  // logged-days-only behaviour rather than inventing a target from nothing.
  const fullWeekTargets = await buildFullWeekTargets(clientId, startDate, endDate);

  const summary = calculateWeeklySummaryFromLogs(
    logs,
    startDate,
    daysInPeriod,
    fullWeekTargets ?? undefined,
    endDate
  );

  return {
    ...summary,
    id: "",
    clientId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
