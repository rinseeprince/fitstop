import { supabaseAdmin } from "./supabase-admin";
import type { DailyLog, DailyLogInput, NutritionAdherenceStatus } from "@/types/daily-log";
import type { DayOfWeek } from "@/types/check-in";
import { getTodayDateString, getDateString, getDateDaysAgo } from "@/lib/date-helpers";
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

type DailyLogInputWithTargets = DailyLogInput & {
  targetCalories?: number;
  targetProteinG?: number;
  targetCarbsG?: number;
  targetFatG?: number;
  nutritionPlanId?: string;
  trainingPlanId?: string;
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

export const calculateStreakFromLogs = (
  logs: DailyLog[],
  today: Date = new Date()
): StreakResult => {
  if (!logs.length) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  const checkDate = new Date(today);
  let isCalculatingCurrent = true;

  const todayDate = getDateString(checkDate);
  const hasLogToday = sortedLogs.some(log => log.date === todayDate);

  if (!hasLogToday) {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (checkDate.getFullYear() >= today.getFullYear() - 1) {
    const logDate = getDateString(checkDate);
    const hasLogForDate = sortedLogs.some(log => log.date === logDate);

    if (hasLogForDate) {
      tempStreak++;
      if (isCalculatingCurrent) {
        currentStreak = tempStreak;
      }
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      if (isCalculatingCurrent && tempStreak > 0) {
        isCalculatingCurrent = false;
      }
      tempStreak = 0;
    }

    checkDate.setDate(checkDate.getDate() - 1);
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  return { currentStreak, longestStreak };
};


export const getDayOfWeekLowercase = (date: Date): DayOfWeek => {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
};

const mapViewRowToDailyLog = (row: DailyLogFullRow): DailyLog => ({
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

export const upsertDailyLog = async (
  clientId: string,
  data: DailyLogInputWithTargets
): Promise<DailyLog> => {
  const nutritionAdherence = calculateNutritionAdherence(
    data.caloriesConsumed,
    data.targetCalories
  );
  const calorieSurplusDeficit = calculateCalorieSurplusDeficit(
    data.caloriesConsumed,
    data.targetCalories
  );

  // Build domain-specific JSONB params for the atomic RPC
  const wellnessData = (data.mood != null || data.energy != null || data.sleep != null || data.stress != null)
    ? { mood: data.mood ?? null, energy: data.energy ?? null, sleep: data.sleep ?? null, stress: data.stress ?? null }
    : null;

  const nutritionData = (data.caloriesConsumed != null || data.targetCalories != null)
    ? {
        calories_consumed: data.caloriesConsumed ?? null,
        protein_g: data.proteinG ?? null,
        carbs_g: data.carbsG ?? null,
        fat_g: data.fatG ?? null,
        target_calories: data.targetCalories ?? null,
        target_protein_g: data.targetProteinG ?? null,
        target_carbs_g: data.targetCarbsG ?? null,
        target_fat_g: data.targetFatG ?? null,
        nutrition_adherence: nutritionAdherence,
        calorie_surplus_deficit: calorieSurplusDeficit,
      }
    : null;

  const trainingData = (data.trained != null)
    ? {
        trained: data.trained ?? false,
        training_session_id: data.trainingSessionId ?? null,
        training_data: data.trainingData ?? null,
      }
    : null;

  const { data: logId, error: rpcError } = await supabaseAdmin
    .rpc("upsert_daily_log_atomic" as never, {
      p_client_id: clientId,
      p_date: data.date,
      p_notes: data.notes ?? null,
      p_wellness: wellnessData,
      p_nutrition: nutritionData,
      p_training: trainingData,
      p_nutrition_plan_id: data.nutritionPlanId ?? null,
      p_training_plan_id: data.trainingPlanId ?? null,
    } as never) as unknown as { data: string | null; error: { message: string } | null };

  if (rpcError || !logId) {
    throw new Error(`Failed to upsert daily log: ${rpcError?.message ?? "No log ID returned"}`);
  }

  // Fetch the full row from the view for the response
  const { data: fullRow, error: fetchError } = await supabaseAdmin
    .from("daily_logs_full" as never)
    .select("*")
    .eq("id" as never, logId as never)
    .single() as unknown as { data: DailyLogFullRow | null; error: { message: string } | null };

  if (fetchError || !fullRow) {
    throw new Error(`Failed to fetch daily log after upsert: ${fetchError?.message ?? "No data"}`);
  }

  return mapViewRowToDailyLog(fullRow);
};

export const getDailyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DailyLog[]> => {
  const { data, error } = await supabaseAdmin
    .from("daily_logs_full" as never)
    .select("*")
    .eq("client_id" as never, clientId as never)
    .gte("date" as never, startDate as never)
    .lte("date" as never, endDate as never)
    .order("date" as never, { ascending: true }) as unknown as { data: DailyLogFullRow[] | null; error: { message: string } | null };

  if (error) {
    throw new Error(`Failed to fetch daily logs: ${error.message}`);
  }

  return (data || []).map(mapViewRowToDailyLog);
};

export const getWeeklyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<Pick<DailyLog, "date" | "id">[]> => {
  // Queries spine only - no view needed
  const { data, error } = await supabaseAdmin
    .from("daily_logs")
    .select("id, date")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch weekly logs: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    date: row.date,
  }));
};

export const getTodayLog = async (clientId: string, date?: string): Promise<DailyLog | null> => {
  const targetDate = date || getTodayDateString();

  const { data, error } = await supabaseAdmin
    .from("daily_logs_full" as never)
    .select("*")
    .eq("client_id" as never, clientId as never)
    .eq("date" as never, targetDate as never)
    .single() as unknown as { data: DailyLogFullRow | null; error: { message: string } | null };

  if (error || !data) {
    return null;
  }

  return mapViewRowToDailyLog(data);
};

export const calculateStreaks = async (clientId: string): Promise<StreakResult> => {
  const endDate = getTodayDateString();
  const startDate = getDateDaysAgo(365);

  const logs = await getDailyLogs(clientId, startDate, endDate);

  return calculateStreakFromLogs(logs);
};
