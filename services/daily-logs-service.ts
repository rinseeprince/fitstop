import { supabaseAdmin } from "./supabase-admin";
import { calculateNutritionAdherence, calculateCalorieSurplusDeficit } from "@/lib/nutrition-verdict";
import type { Database } from "@/types/database";
import type { DailyLog } from "@/types/daily-log";

import { getClientTodayString } from "./today-service";
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from "./nutrition-days-service";

// A day of the day-form is assembled from two tables, each found by
// (client_id, date): the wellness row's five scores and the food row's four
// consumed values, each with its own stamps. The nutrition columns are what
// the client ATE: a day's target and its verdict are derived from the computed
// day, never read off a row. The two column lists are spelled once — the
// attention feed's cross-client reads select the same columns.
export const WELLNESS_LOG_COLUMNS =
  "client_id, date, mood, energy, sleep, stress, soreness, created_at, updated_at";
export const NUTRITION_LOG_COLUMNS =
  "client_id, date, calories_consumed, protein_g, carbs_g, fat_g, created_at, updated_at";

export type WellnessLogRow = Pick<
  Database["public"]["Tables"]["wellness_logs"]["Row"],
  "client_id" | "date" | "mood" | "energy" | "sleep" | "stress" | "soreness" | "created_at" | "updated_at"
>;
export type NutritionLogRow = Pick<
  Database["public"]["Tables"]["nutrition_logs"]["Row"],
  "client_id" | "date" | "calories_consumed" | "protein_g" | "carbs_g" | "fat_g" | "created_at" | "updated_at"
>;

// The per-day verdict lives in the pure module so the kernel and every rail
// share it without this service's database client in their import chain;
// re-exported here for the readers that always took it from this service.
export { calculateNutritionAdherence, calculateCalorieSurplusDeficit } from "@/lib/nutrition-verdict";

const earliestStamp = (stamps: string[]): string =>
  stamps.reduce((min, stamp) => (Date.parse(stamp) < Date.parse(min) ? stamp : min));
const latestStamp = (stamps: string[]): string =>
  stamps.reduce((max, stamp) => (Date.parse(stamp) > Date.parse(max) ? stamp : max));

/**
 * A day of the day-form, assembled from its rows — the wellness row, the food
 * row, at least one of them — plus the day's target as COMPUTED: the three
 * target fields, the verdict and the surplus are derived here from what the
 * client ate against that target, and a day with no computed target (a gap
 * between plans) carries no target and no verdict. A day has no row of its
 * own, so its `id` is its date — stable and unique per client, the same before
 * and after every write of the day, like `NutritionEvent.id` — and its stamps
 * are the earliest `created_at` and the latest `updated_at` of its rows.
 */
export const assembleDayLog = (
  clientId: string,
  date: string,
  wellness: WellnessLogRow | null,
  nutrition: NutritionLogRow | null,
  target: NutritionDayTarget | null = null
): DailyLog => {
  const rows = [wellness, nutrition].filter((row) => row != null);
  if (rows.length === 0) {
    throw new Error(`A day is assembled from at least one row (client ${clientId}, ${date})`);
  }
  const consumed = nutrition?.calories_consumed ?? undefined;
  return {
    id: date,
    clientId,
    date,
    mood: wellness?.mood ?? undefined,
    energy: wellness?.energy ?? undefined,
    sleep: wellness?.sleep ?? undefined,
    stress: wellness?.stress ?? undefined,
    soreness: wellness?.soreness ?? undefined,
    caloriesConsumed: consumed,
    proteinG: nutrition?.protein_g ?? undefined,
    carbsG: nutrition?.carbs_g ?? undefined,
    fatG: nutrition?.fat_g ?? undefined,
    targetCalories: target?.calories,
    targetProteinG: target?.proteinG,
    targetCarbsG: target?.carbsG,
    targetFatG: target?.fatG,
    nutritionAdherence: calculateNutritionAdherence(consumed, target?.calories) ?? undefined,
    calorieSurplusDeficit: calculateCalorieSurplusDeficit(consumed, target?.calories) ?? undefined,
    createdAt: earliestStamp(rows.map((row) => row.created_at)),
    updatedAt: latestStamp(rows.map((row) => row.updated_at)),
  };
};

/**
 * The day-form over a range: the wellness rows, the food rows and the computed
 * targets read together, the number of days deciding nothing, and folded per
 * date in date order. A date is listed when either table holds a row on it.
 */
export const getDailyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DailyLog[]> => {
  const [wellness, nutrition, targets] = await Promise.all([
    supabaseAdmin
      .from("wellness_logs")
      .select(WELLNESS_LOG_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true }),
    supabaseAdmin
      .from("nutrition_logs")
      .select(NUTRITION_LOG_COLUMNS)
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true }),
    getNutritionTargetsForDateRange(clientId, startDate, endDate),
  ]);

  if (wellness.error) {
    throw new Error(`Failed to fetch wellness logs: ${wellness.error.message}`);
  }
  if (nutrition.error) {
    throw new Error(`Failed to fetch nutrition logs: ${nutrition.error.message}`);
  }

  const wellnessByDate = new Map((wellness.data ?? []).map((row) => [row.date, row]));
  const nutritionByDate = new Map((nutrition.data ?? []).map((row) => [row.date, row]));
  const dates = [...new Set([...wellnessByDate.keys(), ...nutritionByDate.keys()])].sort();

  return dates.map((date) =>
    assembleDayLog(
      clientId,
      date,
      wellnessByDate.get(date) ?? null,
      nutritionByDate.get(date) ?? null,
      targets.get(date) ?? null
    )
  );
};

/** One day of the day-form, or null when neither table holds a row on it. */
export const getTodayLog = async (clientId: string, date?: string): Promise<DailyLog | null> => {
  const targetDate = date || (await getClientTodayString(clientId));

  const [wellness, nutrition, targets] = await Promise.all([
    supabaseAdmin
      .from("wellness_logs")
      .select(WELLNESS_LOG_COLUMNS)
      .eq("client_id", clientId)
      .eq("date", targetDate)
      .maybeSingle(),
    supabaseAdmin
      .from("nutrition_logs")
      .select(NUTRITION_LOG_COLUMNS)
      .eq("client_id", clientId)
      .eq("date", targetDate)
      .maybeSingle(),
    getNutritionTargetsForDateRange(clientId, targetDate, targetDate),
  ]);

  if (wellness.error) {
    throw new Error(`Failed to fetch wellness log: ${wellness.error.message}`);
  }
  if (nutrition.error) {
    throw new Error(`Failed to fetch nutrition log: ${nutrition.error.message}`);
  }
  if (!wellness.data && !nutrition.data) {
    return null;
  }

  return assembleDayLog(clientId, targetDate, wellness.data, nutrition.data, targets.get(targetDate) ?? null);
};
