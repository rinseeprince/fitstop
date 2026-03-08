import { supabaseAdmin } from "./supabase-admin";
import type { DailyLog, DailyLogInput, NutritionAdherenceStatus } from "@/types/daily-log";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getClientNutritionTargets, getClientTrainingPlan } from "./client-portal-service";
import type { Database } from "@/types/database";
import { getTodayDateString, getDateString, getDateDaysAgo } from "@/lib/date-helpers";
import { NUTRITION_ADHERENCE_HIT_THRESHOLD, NUTRITION_ADHERENCE_PARTIAL_THRESHOLD } from "@/lib/constants";

type DailyLogRow = Database["public"]["Tables"]["daily_logs"]["Row"];

type DailyLogInputWithTargets = DailyLogInput & {
  targetCalories?: number;
  targetProteinG?: number;
  targetCarbsG?: number;
  targetFatG?: number;
};

type StreakResult = {
  currentStreak: number;
  longestStreak: number;
};

type TodaysTrainingSession = {
  sessionId: string;
  sessionName: string;
  estimatedCalories: number;
} | null;

type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
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
  let checkDate = new Date(today);
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


export const getDayOfWeekLowercase = (date: Date): string => {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
};

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

  const logData = {
    client_id: clientId,
    date: data.date,
    mood: data.mood,
    energy: data.energy,
    sleep: data.sleep,
    stress: data.stress,
    notes: data.notes,
    trained: data.trained,
    training_session_id: data.trainingSessionId,
    training_data: data.trainingData || null,
    calories_consumed: data.caloriesConsumed,
    protein_g: data.proteinG,
    carbs_g: data.carbsG,
    fat_g: data.fatG,
    target_calories: data.targetCalories,
    target_protein_g: data.targetProteinG,
    target_carbs_g: data.targetCarbsG,
    target_fat_g: data.targetFatG,
    nutrition_adherence: nutritionAdherence,
    calorie_surplus_deficit: calorieSurplusDeficit,
    updated_at: new Date().toISOString(),
  };

  const { data: result, error } = await supabaseAdmin
    .from("daily_logs")
    .upsert(logData, {
      onConflict: "client_id,date",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert daily log: ${error.message}`);
  }

  return {
    id: result.id,
    clientId: result.client_id,
    date: result.date,
    mood: result.mood ?? undefined,
    energy: result.energy ?? undefined,
    sleep: result.sleep ?? undefined,
    stress: result.stress ?? undefined,
    notes: result.notes ?? undefined,
    trained: result.trained ?? undefined,
    trainingSessionId: result.training_session_id ?? undefined,
    trainingData: result.training_data as DailyLog['trainingData'],
    caloriesConsumed: result.calories_consumed ?? undefined,
    proteinG: result.protein_g ?? undefined,
    carbsG: result.carbs_g ?? undefined,
    fatG: result.fat_g ?? undefined,
    targetCalories: result.target_calories ?? undefined,
    targetProteinG: result.target_protein_g ?? undefined,
    targetCarbsG: result.target_carbs_g ?? undefined,
    targetFatG: result.target_fat_g ?? undefined,
    nutritionAdherence: result.nutrition_adherence as NutritionAdherenceStatus ?? undefined,
    calorieSurplusDeficit: result.calorie_surplus_deficit ?? undefined,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const getDailyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DailyLog[]> => {
  const { data, error } = await supabaseAdmin
    .from("daily_logs")
    .select("*")
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch daily logs: ${error.message}`);
  }

  return (data || []).map((row: DailyLogRow) => ({
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
    nutritionAdherence: row.nutrition_adherence as NutritionAdherenceStatus | undefined,
    calorieSurplusDeficit: row.calorie_surplus_deficit ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const getWeeklyLogs = async (
  clientId: string,
  startDate: string,
  endDate: string
): Promise<Pick<DailyLog, "date" | "id">[]> => {
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
    .from("daily_logs")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", targetDate)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    clientId: data.client_id,
    date: data.date,
    mood: data.mood ?? undefined,
    energy: data.energy ?? undefined,
    sleep: data.sleep ?? undefined,
    stress: data.stress ?? undefined,
    notes: data.notes ?? undefined,
    trained: data.trained ?? undefined,
    trainingSessionId: data.training_session_id ?? undefined,
    trainingData: data.training_data as DailyLog['trainingData'],
    caloriesConsumed: data.calories_consumed ?? undefined,
    proteinG: data.protein_g ?? undefined,
    carbsG: data.carbs_g ?? undefined,
    fatG: data.fat_g ?? undefined,
    targetCalories: data.target_calories ?? undefined,
    targetProteinG: data.target_protein_g ?? undefined,
    targetCarbsG: data.target_carbs_g ?? undefined,
    targetFatG: data.target_fat_g ?? undefined,
    nutritionAdherence: data.nutrition_adherence as NutritionAdherenceStatus ?? undefined,
    calorieSurplusDeficit: data.calorie_surplus_deficit ?? undefined,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
};

export const calculateStreaks = async (clientId: string): Promise<StreakResult> => {
  const endDate = getTodayDateString();
  const startDate = getDateDaysAgo(365);
  
  const logs = await getDailyLogs(clientId, startDate, endDate);
  
  return calculateStreakFromLogs(logs);
};

export const getTodaysTrainingSession = async (clientId: string, date?: string): Promise<TodaysTrainingSession> => {
  const targetDate = date ? new Date(date + 'T00:00:00') : new Date();
  const todayDayOfWeek = getDayOfWeekLowercase(targetDate);
  
  const trainingPlan = await getClientTrainingPlan(clientId);
  
  if (!trainingPlan) return null;
  
  const session = trainingPlan.sessions.find(
    (session) =>
      session.dayOfWeek?.toLowerCase() === todayDayOfWeek &&
      session.sessionType === "training"
  );
  
  if (!session) return null;
  
  return {
    sessionId: session.id,
    sessionName: session.name,
    estimatedCalories: session.estimatedCalories || 0,
  };
};

export const getTodaysPlannedActivities = async (clientId: string, date?: string): Promise<TodaysActivity[]> => {
  const targetDate = date ? new Date(date + 'T00:00:00') : new Date();
  const todayDayOfWeek = getDayOfWeekLowercase(targetDate);
  
  const trainingPlan = await getClientTrainingPlan(clientId);
  
  if (!trainingPlan) return [];
  
  const activities = trainingPlan.sessions.filter(
    (session) =>
      session.dayOfWeek?.toLowerCase() === todayDayOfWeek &&
      session.sessionType === "external_activity"
  );
  
  return activities.map((activity) => ({
    sessionId: activity.id,
    activityName: activity.name,
    estimatedCalories: activity.activityMetadata?.estimatedCalories || 0,
  }));
};

export const getTodaysNutritionTarget = async (clientId: string, date?: string): Promise<DailyNutritionTargets | null> => {
  const nutritionTargets = await getClientNutritionTargets(clientId);

  if (!nutritionTargets?.dailyTargets) return null;

  const targetDate = date ? new Date(date + 'T00:00:00') : new Date();
  const todayDayOfWeek = getDayOfWeekLowercase(targetDate);

  const todayTarget = nutritionTargets.dailyTargets.find(
    (target) => target.day === todayDayOfWeek
  );

  if (!todayTarget) return null;

  return {
    ...todayTarget,
    includeActivityBurn: nutritionTargets.includeActivityBurn,
  };
};