import { supabaseAdmin } from "./supabase-admin"; // system-level upserts + RLS-free reads
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import { getWeekEnd, getWeekDays, getTrainingWeekStart, getTrainingWeekEnd, getTrainingWeekDays, getTodayDateString } from "@/lib/date-helpers";
import { getPlanTargetForDate } from "@/services/daily-context-service";
import { calculateWeeklySummaryFromLogs, type FullWeekTargets } from "@/utils/weekly-nutrition-helpers";
import { mapNutritionRowToDailyLog, mapRowToSummary, type NutritionRow } from "@/utils/weekly-nutrition-mappers";

// Re-export pure helpers so existing consumers don't break
export { calculateWeeklySummaryFromLogs, calculateWeeklyAdherence, type FullWeekTargets } from "@/utils/weekly-nutrition-helpers";

const NUTRITION_LOG_SELECT =
  "id, client_id, date, calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g, created_at, updated_at";

/** Fetches daily logs for a week, calculates summary, and upserts to DB. */
export async function upsertWeeklySummary(
  clientId: string,
  weekStartDate: string
): Promise<WeeklyNutritionSummary> {
  const weekEnd = getWeekEnd(weekStartDate);

  // Check client start_date for partial week handling
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("start_date")
    .eq("id", clientId)
    .eq("active", true)
    .single();

  const clientStartDate = client?.start_date ?? null;
  // If client started mid-week, only count from their start date
  const effectiveStart = clientStartDate && clientStartDate > weekStartDate
    ? clientStartDate
    : weekStartDate;

  const effectiveEnd = weekEnd;
  // Calculate days in this (possibly partial) week
  const startMs = new Date(effectiveStart + "T00:00:00").getTime();
  const endMs = new Date(effectiveEnd + "T00:00:00").getTime();
  const daysInWeek = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from("nutrition_logs" as never)
    .select(NUTRITION_LOG_SELECT)
    .eq("client_id" as never, clientId as never)
    .gte("date" as never, effectiveStart as never)
    .lte("date" as never, effectiveEnd as never)
    .order("date" as never, { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

  if (fetchError) {
    console.error("Failed to fetch nutrition logs for weekly summary:", fetchError.message);
    throw new Error("Failed to fetch nutrition logs for weekly summary");
  }

  const logs = (rows || []).map(mapNutritionRowToDailyLog);

  // Build full-week target: logged days use their saved targets, unlogged days use current plan
  const loggedDates = new Set(logs.map((l) => l.date));
  const allDaysInRange = getWeekDays(weekStartDate).filter(
    (d) => d >= effectiveStart && d <= effectiveEnd
  );
  const unloggedDays = allDaysInRange.filter((d) => !loggedDates.has(d));

  let fullWeekCal = logs.reduce((sum, l) => sum + (l.targetCalories ?? 0), 0);
  let fullWeekProtein = logs.reduce((sum, l) => sum + (l.targetProteinG ?? 0), 0);
  let fullWeekCarbs = logs.reduce((sum, l) => sum + (l.targetCarbsG ?? 0), 0);
  let fullWeekFat = logs.reduce((sum, l) => sum + (l.targetFatG ?? 0), 0);

  // Fill in unlogged days with the plan that was active on each specific date
  const planTargets = await Promise.all(
    unloggedDays.map((d) => getPlanTargetForDate(clientId, d))
  );
  for (const pt of planTargets) {
    if (!pt) continue;
    fullWeekCal += pt.calories;
    fullWeekProtein += pt.proteinG ?? 0;
    fullWeekCarbs += pt.carbsG ?? 0;
    fullWeekFat += pt.fatG ?? 0;
  }

  const fullWeekTargets: FullWeekTargets = {
    calories: fullWeekCal,
    proteinG: fullWeekProtein || null,
    carbsG: fullWeekCarbs || null,
    fatG: fullWeekFat || null,
  };

  const summary = calculateWeeklySummaryFromLogs(logs, weekStartDate, daysInWeek, fullWeekTargets);

  const { data: result, error: upsertError } = await supabaseAdmin
    .from("nutrition_weekly_summaries")
    .upsert(
      {
        client_id: clientId,
        week_start_date: weekStartDate,
        week_end_date: summary.weekEndDate,
        weekly_calorie_target: summary.totalTargetCalories,
        weekly_protein_target_g: summary.totalTargetProteinG,
        weekly_carbs_target_g: summary.totalTargetCarbsG,
        weekly_fat_target_g: summary.totalTargetFatG,
        total_calories_consumed: summary.totalCaloriesConsumed,
        total_protein_consumed_g: summary.totalProteinConsumedG,
        total_carbs_consumed_g: summary.totalCarbsConsumedG,
        total_fat_consumed_g: summary.totalFatConsumedG,
        calorie_difference: summary.calorieDifference,
        adherence_percentage: summary.adherencePercentage,
        weekly_adherence: summary.weeklyAdherence,
        total_days: summary.daysInWeek,
        days_logged: summary.daysLogged,
        days_on_target: summary.daysOnTarget,
        days_over: summary.daysOver,
        days_under: summary.daysUnder,
        days_completed: summary.daysLogged,
        completion_percentage: summary.adherencePercentage,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,week_start_date" }
    )
    .select()
    .single();

  if (upsertError) {
    console.error("Failed to upsert weekly nutrition summary:", upsertError.message);
    throw new Error("Failed to upsert weekly nutrition summary");
  }

  return mapRowToSummary(result);
}

/** Fetches weekly summaries for a client within a date range. */
export async function getWeeklySummaries(
  clientId: string,
  startDate?: string,
  endDate?: string
): Promise<WeeklyNutritionSummary[]> {
  let query = supabaseAdmin
    .from("nutrition_weekly_summaries")
    .select("*")
    .eq("client_id", clientId)
    .order("week_start_date", { ascending: false });

  if (startDate) query = query.gte("week_start_date", startDate);
  if (endDate) query = query.lte("week_start_date", endDate);

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch weekly summaries:", error.message);
    throw new Error("Failed to fetch weekly summaries");
  }

  return (data || []).map(mapRowToSummary);
}

/** Computes a nutrition summary for an arbitrary date range from nutrition_logs. */
export async function getNutritionSummaryForPeriod(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<WeeklyNutritionSummary | null> {
  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_logs" as never)
    .select(NUTRITION_LOG_SELECT)
    .eq("client_id" as never, clientId as never)
    .gte("date" as never, startDate as never)
    .lte("date" as never, endDate as never)
    .order("date" as never, { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

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

/** Fetches the most recent weekly summary for a client. */
export async function getLatestWeeklySummary(
  clientId: string
): Promise<WeeklyNutritionSummary | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_weekly_summaries")
    .select("*")
    .eq("client_id", clientId)
    .order("week_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch latest weekly summary:", error.message);
    throw new Error("Failed to fetch latest weekly summary");
  }

  return data ? mapRowToSummary(data) : null;
}

/** Computes the current coaching week's nutrition summary live from nutrition_logs. */
export async function getCoachingWeekSummaryLive(
  clientId: string,
  checkInDay: string | null
): Promise<WeeklyNutritionSummary | null> {
  const today = getTodayDateString();
  const weekStart = getTrainingWeekStart(today, checkInDay);
  const weekEnd = getTrainingWeekEnd(today, checkInDay);

  // Fetch client start_date for partial week handling
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("start_date")
    .eq("id", clientId)
    .eq("active", true)
    .single();

  const clientStartDate = client?.start_date ?? null;
  const effectiveStart = clientStartDate && clientStartDate > weekStart
    ? clientStartDate
    : weekStart;

  const startMs = new Date(effectiveStart + "T00:00:00").getTime();
  const endMs = new Date(weekEnd + "T00:00:00").getTime();
  const daysInWeek = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;

  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_logs" as never)
    .select(NUTRITION_LOG_SELECT)
    .eq("client_id" as never, clientId as never)
    .gte("date" as never, effectiveStart as never)
    .lte("date" as never, weekEnd as never)
    .order("date" as never, { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("Failed to fetch nutrition logs for coaching week summary:", error.message);
    throw new Error("Failed to fetch nutrition logs for coaching week summary");
  }

  const logs = (rows || []).map(mapNutritionRowToDailyLog);

  // Build full-week targets: logged days use saved snapshots, unlogged days use current plan
  const loggedDates = new Set(logs.map((l) => l.date));
  const allDaysInRange = getTrainingWeekDays(weekStart, checkInDay).filter(
    (d) => d >= effectiveStart && d <= weekEnd
  );
  const unloggedDays = allDaysInRange.filter((d) => !loggedDates.has(d));

  let fullWeekCal = logs.reduce((sum, l) => sum + (l.targetCalories ?? 0), 0);
  let fullWeekProtein = logs.reduce((sum, l) => sum + (l.targetProteinG ?? 0), 0);
  let fullWeekCarbs = logs.reduce((sum, l) => sum + (l.targetCarbsG ?? 0), 0);
  let fullWeekFat = logs.reduce((sum, l) => sum + (l.targetFatG ?? 0), 0);

  const planTargets = await Promise.all(
    unloggedDays.map((d) => getPlanTargetForDate(clientId, d))
  );
  for (const pt of planTargets) {
    if (!pt) continue;
    fullWeekCal += pt.calories;
    fullWeekProtein += pt.proteinG ?? 0;
    fullWeekCarbs += pt.carbsG ?? 0;
    fullWeekFat += pt.fatG ?? 0;
  }

  const fullWeekTargets: FullWeekTargets = {
    calories: fullWeekCal,
    proteinG: fullWeekProtein || null,
    carbsG: fullWeekCarbs || null,
    fatG: fullWeekFat || null,
  };

  const summary = calculateWeeklySummaryFromLogs(logs, effectiveStart, daysInWeek, fullWeekTargets, weekEnd);

  return {
    ...summary,
    id: "",
    clientId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
