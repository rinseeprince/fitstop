import { supabaseAdmin } from "./supabase-admin";
import type { DailyLog, NutritionAdherenceStatus } from "@/types/daily-log";
import type { DayOfWeek } from "@/types/check-in";
import { getDateString, getDateDaysFrom, dateStringToDayNumber } from "@/lib/date-helpers";
import { getClientTodayString } from "./today-service";
import { NUTRITION_ADHERENCE_HIT_THRESHOLD, NUTRITION_ADHERENCE_PARTIAL_THRESHOLD } from "@/lib/constants";

// Shape returned by the daily_logs_full view (not yet in generated types)
type DailyLogFullRow = {
  id: string;
  client_id: string;
  date: string;
  notes: string | null;
  phase_id: string | null;
  created_at: string;
  updated_at: string;
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  stress: number | null;
  calories_consumed: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  nutrition_adherence: string | null;
  calorie_surplus_deficit: number | null;
  trained: boolean | null;
  training_session_id: string | null;
  training_data: unknown;
};

type StreakResult = {
  currentStreak: number;
  longestStreak: number;
};

export const calculateNutritionAdherence = (
  caloriesConsumed?: number,
  targetCalories?: number
): NutritionAdherenceStatus | null => {
  if (!caloriesConsumed || !targetCalories) return null;

  const difference = Math.abs(caloriesConsumed - targetCalories);

  if (difference <= NUTRITION_ADHERENCE_HIT_THRESHOLD) return "hit";
  if (difference <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD) return "partial";
  return "missed";
};

export const calculateCalorieSurplusDeficit = (
  caloriesConsumed?: number,
  targetCalories?: number
): number | null => {
  if (!caloriesConsumed || !targetCalories) return null;
  return caloriesConsumed - targetCalories;
};

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


export const getDayOfWeekLowercase = (date: Date): DayOfWeek => {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
};

export const mapRowToDailyLog = (row: DailyLogFullRow): DailyLog => ({
  id: row.id,
  clientId: row.client_id,
  date: row.date,
  mood: row.mood ?? undefined,
  energy: row.energy ?? undefined,
  sleep: row.sleep ?? undefined,
  stress: row.stress ?? undefined,
  notes: row.notes ?? undefined,
  trained: row.trained ?? undefined,
  trainingSessionId: row.training_session_id ?? undefined,
  trainingData: row.training_data as DailyLog['trainingData'],
  caloriesConsumed: row.calories_consumed ?? undefined,
  proteinG: row.protein_g ?? undefined,
  carbsG: row.carbs_g ?? undefined,
  fatG: row.fat_g ?? undefined,
  targetCalories: row.target_calories ?? undefined,
  targetProteinG: row.target_protein_g ?? undefined,
  targetCarbsG: row.target_carbs_g ?? undefined,
  targetFatG: row.target_fat_g ?? undefined,
  nutritionAdherence: (row.nutrition_adherence as NutritionAdherenceStatus | null) ?? undefined,
  calorieSurplusDeficit: row.calorie_surplus_deficit ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getDailyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DailyLog[]> => {
  const { data, error } = (await supabaseAdmin
    .from("daily_logs_full")
    .select("*")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })) as unknown as { data: DailyLogFullRow[] | null; error: { message: string } | null };

  if (error) {
    throw new Error(`Failed to fetch daily logs: ${error.message}`);
  }

  return (data || []).map(mapRowToDailyLog);
};

export const getTodayLog = async (clientId: string, date?: string): Promise<DailyLog | null> => {
  const targetDate = date || (await getClientTodayString(clientId));

  const { data, error } = (await supabaseAdmin
    .from("daily_logs_full")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", targetDate)
    .single()) as unknown as { data: DailyLogFullRow | null; error: { message: string } | null };

  if (error || !data) {
    return null;
  }

  return mapRowToDailyLog(data);
};

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
