import { supabaseAdmin } from "./supabase-admin";
import { calculateNutritionAdherence, calculateCalorieSurplusDeficit } from "@/lib/nutrition-verdict";
import type { DailyLog } from "@/types/daily-log";

import { getDateString, getDateDaysFrom, dateStringToDayNumber } from "@/lib/date-helpers";
import { getClientTodayString } from "./today-service";
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from "./nutrition-days-service";

// Shape returned by the daily_logs_full view (mirrors Views.daily_logs_full.Row
// in types/database.ts; kept hand-typed for the narrowing casts below). The
// nutrition columns are what the client ATE: a day's target and its verdict
// are derived from the computed day, never read off a row.
type DailyLogFullRow = {
  id: string;
  client_id: string;
  date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  stress: number | null;
  soreness: number | null;
  calories_consumed: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  trained: boolean | null;
  training_session_id: string | null;
  training_data: unknown;
};

type StreakResult = {
  currentStreak: number;
  longestStreak: number;
};

// The per-day verdict lives in the pure module so the kernel and every rail
// share it without this service's database client in their import chain;
// re-exported here for the readers that always took it from this service.
export { calculateNutritionAdherence, calculateCalorieSurplusDeficit } from "@/lib/nutrition-verdict";

/**
 * Reference implementation of the streak semantics, kept as the unit-test oracle
 * that the `get_client_streak` RPC must match. Production reads go through the RPC
 * (services/daily-logs-service.ts `calculateStreaks`), not this function.
 *
 * - Current streak = the consecutive run ending today (if logged) or yesterday
 *   (if today is not yet logged), else 0.
 * - Longest streak = the longest run of consecutive days among the provided logs.
 *
 * BEHAVIOR CHANGE (session 3.7 bugfix): a leading gap now correctly resets the
 * current streak to 0. The prior loop reported the first logged run found scanning
 * backward as "current" — so e.g. a single log 5 days ago counted as a current
 * streak of 1. O(D log D) via a day-number Set + one sort (was O(D²)).
 */
export const calculateStreakFromLogs = (
  logs: DailyLog[],
  today: Date = new Date()
): StreakResult => {
  if (!logs.length) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const dayNums = new Set(logs.map((log) => dateStringToDayNumber(log.date)));
  const todayNum = dateStringToDayNumber(getDateString(today));

  // Current streak: walk backward from today (if logged) or yesterday.
  let anchor = dayNums.has(todayNum) ? todayNum : todayNum - 1;
  let currentStreak = 0;
  while (dayNums.has(anchor)) {
    currentStreak++;
    anchor--;
  }

  // Longest streak: longest run of consecutive day numbers.
  const sorted = [...dayNums].sort((a, b) => a - b);
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }

  return { currentStreak, longestStreak };
};

/**
 * A row of the day-form plus the day's target as COMPUTED — the three target
 * fields, the verdict and the surplus on `DailyLog` are derived here from what
 * the client ate against that target. A day with no computed target (a gap
 * between plans) carries no target and no verdict.
 */
export const mapRowToDailyLog = (
  row: DailyLogFullRow,
  target: NutritionDayTarget | null = null
): DailyLog => ({
  id: row.id,
  clientId: row.client_id,
  date: row.date,
  mood: row.mood ?? undefined,
  energy: row.energy ?? undefined,
  sleep: row.sleep ?? undefined,
  stress: row.stress ?? undefined,
  soreness: row.soreness ?? undefined,
  notes: row.notes ?? undefined,
  trained: row.trained ?? undefined,
  trainingSessionId: row.training_session_id ?? undefined,
  trainingData: row.training_data as DailyLog['trainingData'],
  caloriesConsumed: row.calories_consumed ?? undefined,
  proteinG: row.protein_g ?? undefined,
  carbsG: row.carbs_g ?? undefined,
  fatG: row.fat_g ?? undefined,
  targetCalories: target?.calories,
  targetProteinG: target?.proteinG,
  targetCarbsG: target?.carbsG,
  targetFatG: target?.fatG,
  nutritionAdherence:
    calculateNutritionAdherence(row.calories_consumed ?? undefined, target?.calories) ?? undefined,
  calorieSurplusDeficit:
    calculateCalorieSurplusDeficit(row.calories_consumed ?? undefined, target?.calories) ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * The day-form rows over a range with each day's computed target — the view
 * read and the target lookup issued together, the number of days deciding
 * nothing.
 */
export const getDailyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DailyLog[]> => {
  const [{ data, error }, targets] = await Promise.all([
    supabaseAdmin
      .from("daily_logs_full")
      .select("*")
      .eq("client_id", clientId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true }) as unknown as PromiseLike<{ data: DailyLogFullRow[] | null; error: { message: string } | null }>,
    getNutritionTargetsForDateRange(clientId, startDate, endDate),
  ]);

  if (error) {
    throw new Error(`Failed to fetch daily logs: ${error.message}`);
  }

  return (data || []).map((row) => mapRowToDailyLog(row, targets.get(row.date) ?? null));
};

export const getTodayLog = async (clientId: string, date?: string): Promise<DailyLog | null> => {
  const targetDate = date || (await getClientTodayString(clientId));

  const [{ data, error }, targets] = await Promise.all([
    supabaseAdmin
      .from("daily_logs_full")
      .select("*")
      .eq("client_id", clientId)
      .eq("date", targetDate)
      .single() as unknown as PromiseLike<{ data: DailyLogFullRow | null; error: { message: string } | null }>,
    getNutritionTargetsForDateRange(clientId, targetDate, targetDate),
  ]);

  if (error || !data) {
    return null;
  }

  return mapRowToDailyLog(data, targets.get(targetDate) ?? null);
};

// No product caller: `get_client_streaks` (migration 095) is read only by the perf
// harness (`scripts/perf-baseline.ts`), and this is the sole TS reader of that RPC.
// Kept for the harness (dead-code sweep 2026-08); `calculateStreakFromLogs` above is
// the unit-test oracle the RPC must match.
export const calculateStreaks = async (clientId: string): Promise<StreakResult> => {
  // "today" (client-local) and the 365-day window anchored to it are computed
  // here and passed to the RPC — never CURRENT_DATE / a SQL DEFAULT
  // (supabase-js sends explicit null for undefined keys, which a DEFAULT
  // would not catch). The RPC does a bounded index-only scan over daily_logs and
  // returns the two streak integers — no daily_logs_full view scan, no O(D²) loop.
  const today = await getClientTodayString(clientId);
  const startDate = getDateDaysFrom(new Date(today + "T00:00:00"), -365);

  const { data, error } = await supabaseAdmin.rpc("get_client_streak", {
    p_client_id: clientId,
    p_today: today,
    p_start_date: startDate,
  });

  if (error) {
    throw new Error(`Failed to calculate streaks: ${error.message}`);
  }

  const row = data?.[0];
  return {
    currentStreak: row?.current_streak ?? 0,
    longestStreak: row?.longest_streak ?? 0,
  };
};
