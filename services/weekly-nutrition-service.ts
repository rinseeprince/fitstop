// supabaseAdmin required: nutrition_weekly_summaries writes are system-level upserts
// from fire-and-forget background operations, and daily_logs has no RLS policies.
import { supabaseAdmin } from "./supabase-admin";
import type { DailyLog } from "@/types/daily-log";
import type { WeeklyNutritionSummary, WeeklyAdherenceStatus } from "@/types/weekly-nutrition";
import type { Database } from "@/types/database";
import { getWeekEnd, getWeekDays } from "@/lib/date-helpers";
import { getPlanTargetForDate } from "@/services/daily-context-service";
import {
  WEEKLY_NUTRITION_HIT_PER_DAY,
  WEEKLY_NUTRITION_PARTIAL_PER_DAY,
  NUTRITION_ADHERENCE_HIT_THRESHOLD,
} from "@/lib/constants";

/** Override targets for the full week (logged days + plan-based unlogged days) */
type FullWeekTargets = {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

/**
 * Pure function: calculates a weekly nutrition summary from daily logs.
 * No DB access — testable in isolation.
 */
export function calculateWeeklySummaryFromLogs(
  logs: DailyLog[],
  weekStartDate: string,
  daysInWeek = 7,
  fullWeekTargets?: FullWeekTargets,
  weekEndDateOverride?: string
): Omit<WeeklyNutritionSummary, "id" | "clientId" | "createdAt" | "updatedAt"> {
  const weekEndDate = weekEndDateOverride ?? getWeekEnd(weekStartDate);

  let totalCaloriesConsumed = 0;
  let totalTargetCalories = 0;
  let totalProteinConsumed = 0;
  let totalTargetProtein = 0;
  let totalCarbsConsumed = 0;
  let totalTargetCarbs = 0;
  let totalFatConsumed = 0;
  let totalTargetFat = 0;

  let daysLogged = 0;
  let daysOnTarget = 0;
  let daysOver = 0;
  let daysUnder = 0;

  let hasAnyTargets = false;
  let hasAnyConsumed = false;

  for (const log of logs) {
    const consumed = log.caloriesConsumed;
    const target = log.targetCalories;

    if (consumed != null) {
      hasAnyConsumed = true;
      daysLogged++;
      totalCaloriesConsumed += consumed;
      totalProteinConsumed += log.proteinG ?? 0;
      totalCarbsConsumed += log.carbsG ?? 0;
      totalFatConsumed += log.fatG ?? 0;
    }

    if (target != null) {
      hasAnyTargets = true;
      totalTargetCalories += target;
      totalTargetProtein += log.targetProteinG ?? 0;
      totalTargetCarbs += log.targetCarbsG ?? 0;
      totalTargetFat += log.targetFatG ?? 0;
    }

    // Day-level classification (only if both consumed and target exist)
    if (consumed != null && target != null) {
      const diff = consumed - target;
      if (Math.abs(diff) <= NUTRITION_ADHERENCE_HIT_THRESHOLD) {
        daysOnTarget++;
      } else if (diff > 0) {
        daysOver++;
      } else {
        daysUnder++;
      }
    }
  }

  // Use full-week targets when provided (logged days + plan-based unlogged days),
  // otherwise fall back to log-derived targets only
  const effectiveTargetCal = fullWeekTargets ? fullWeekTargets.calories : totalTargetCalories;
  const effectiveTargetProtein = fullWeekTargets ? fullWeekTargets.proteinG : totalTargetProtein;
  const effectiveTargetCarbs = fullWeekTargets ? fullWeekTargets.carbsG : totalTargetCarbs;
  const effectiveTargetFat = fullWeekTargets ? fullWeekTargets.fatG : totalTargetFat;
  const effectiveHasTargets = fullWeekTargets ? effectiveTargetCal > 0 : hasAnyTargets;

  const calorieDifference =
    hasAnyConsumed && effectiveHasTargets
      ? totalCaloriesConsumed - effectiveTargetCal
      : null;

  const adherencePercentage =
    hasAnyConsumed && effectiveHasTargets && effectiveTargetCal > 0
      ? Math.round((totalCaloriesConsumed / effectiveTargetCal) * 1000) / 10
      : null;

  const weeklyAdherence = calculateWeeklyAdherence(calorieDifference, daysInWeek);

  return {
    weekStartDate,
    weekEndDate,
    totalTargetCalories: effectiveHasTargets ? effectiveTargetCal : 0,
    totalTargetProteinG: effectiveHasTargets ? effectiveTargetProtein : null,
    totalTargetCarbsG: effectiveHasTargets ? effectiveTargetCarbs : null,
    totalTargetFatG: effectiveHasTargets ? effectiveTargetFat : null,
    totalCaloriesConsumed: hasAnyConsumed ? totalCaloriesConsumed : null,
    totalProteinConsumedG: hasAnyConsumed ? totalProteinConsumed : null,
    totalCarbsConsumedG: hasAnyConsumed ? totalCarbsConsumed : null,
    totalFatConsumedG: hasAnyConsumed ? totalFatConsumed : null,
    calorieDifference,
    adherencePercentage,
    weeklyAdherence,
    daysInWeek,
    daysLogged,
    daysOnTarget,
    daysOver,
    daysUnder,
  };
}

/**
 * Applies scaled weekly adherence thresholds.
 * Thresholds scale with days_in_week for partial weeks.
 */
export function calculateWeeklyAdherence(
  calorieDifference: number | null,
  daysInWeek: number
): WeeklyAdherenceStatus | null {
  if (calorieDifference == null) return null;

  const absDiff = Math.abs(calorieDifference);
  const hitThreshold = WEEKLY_NUTRITION_HIT_PER_DAY * daysInWeek;
  const partialThreshold = WEEKLY_NUTRITION_PARTIAL_PER_DAY * daysInWeek;

  if (absDiff <= hitThreshold) return "hit";
  if (absDiff <= partialThreshold) return "partial";
  return "missed";
}

/**
 * Fetches daily logs for a week, calculates summary, and upserts to DB.
 * Handles partial weeks when a client's start_date falls mid-week.
 */
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

  // Direct query on nutrition_logs - only needs nutrition columns
  type NutritionRow = {
    id: string; client_id: string; date: string;
    calories_consumed: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    target_calories: number | null; target_protein_g: number | null; target_carbs_g: number | null; target_fat_g: number | null;
    created_at: string; updated_at: string;
  };
  const { data: rows, error: fetchError } = await supabaseAdmin
    .from("nutrition_logs" as never)
    .select("id, client_id, date, calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g, created_at, updated_at")
    .eq("client_id" as never, clientId as never)
    .gte("date" as never, effectiveStart as never)
    .lte("date" as never, effectiveEnd as never)
    .order("date" as never, { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

  if (fetchError) {
    console.error("Failed to fetch nutrition logs for weekly summary:", fetchError.message);
    throw new Error("Failed to fetch nutrition logs for weekly summary");
  }

  const logs: DailyLog[] = (rows || []).map((r) => ({
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
  }));

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

/**
 * Fetches weekly summaries for a client within a date range.
 */
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

/**
 * Computes a nutrition summary for an arbitrary date range by querying
 * nutrition_logs directly, bypassing the Mon-Sun pre-aggregated
 * nutrition_weekly_summaries table. Used by the check-in AI summary
 * pipeline so the period aligns to the client's check-in day.
 */
export async function getNutritionSummaryForPeriod(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<WeeklyNutritionSummary | null> {
  type NutritionRow = {
    id: string; client_id: string; date: string;
    calories_consumed: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    target_calories: number | null; target_protein_g: number | null; target_carbs_g: number | null; target_fat_g: number | null;
    created_at: string; updated_at: string;
  };

  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_logs" as never)
    .select("id, client_id, date, calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g, created_at, updated_at")
    .eq("client_id" as never, clientId as never)
    .gte("date" as never, startDate as never)
    .lte("date" as never, endDate as never)
    .order("date" as never, { ascending: true }) as unknown as { data: NutritionRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("Failed to fetch nutrition logs for period summary:", error.message);
    throw new Error("Failed to fetch nutrition logs for period summary");
  }

  if (!rows || rows.length === 0) return null;

  const logs: DailyLog[] = rows.map((r) => ({
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
  }));

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

/**
 * Fetches the most recent weekly summary for a client.
 */
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

type NWSRow = Database["public"]["Tables"]["nutrition_weekly_summaries"]["Row"];

function mapRowToSummary(row: NWSRow): WeeklyNutritionSummary {
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
