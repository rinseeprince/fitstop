/**
 * Daily Context Service
 * Provides today's training sessions, planned activities, and nutrition targets
 * for use in daily log entry and context display.
 */

import { supabaseAdmin } from "./supabase-admin";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getClientNutritionTargets } from "./client-portal-service";
import { getClientTrainingPlan } from "./client-portal-training";
import { getActiveTrainingPlan } from "./training-service";
import { getTrainingSessionCaloriesByDay } from "@/utils/training-calorie-helpers";
import { getExternalActivitiesForDay, calculateExternalActivityCalories } from "@/utils/nutrition-helpers";
import { getDayOfWeekLowercase } from "./daily-logs-service";
import { getEventForDate } from "./training-event-service";
import { getTodayDateString } from "@/lib/date-helpers";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getTotalCalories, mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";

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

export const getTodaysTrainingSession = async (clientId: string, date?: string): Promise<TodaysTrainingSession> => {
  const dateStr = date ?? getTodayDateString();
  const event = await getEventForDate(clientId, dateStr);
  if (!event) return null;
  return {
    sessionId: event.trainingSessionId ?? event.id,
    sessionName: event.sessionName,
    estimatedCalories: event.estimatedCalories ?? 0,
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
  const dateStr = date ?? getTodayDateString();
  const event = await getNutritionEventForDate(clientId, dateStr);

  if (event) {
    const { data: clientRow } = await supabaseAdmin
      .from("clients").select("include_activity_burn").eq("id", clientId).single();
    const includeActivityBurn = clientRow?.include_activity_burn !== false;
    const target = mapNutritionEventToDisplayTarget(event, includeActivityBurn);
    return { ...target, planId: event.nutritionPlanId, includeActivityBurn };
  }

  // TODO NE-3-cleanup: remove template fallback once event coverage guaranteed
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
    planId: nutritionTargets.planId,
    includeActivityBurn: nutritionTargets.includeActivityBurn,
  };
};

/**
 * Find the plan that was active on a specific date and return its daily target.
 * Tries nutrition_events first (accurate per-date burns), falls back to template.
 * Optional includeActivityBurn avoids repeated clients table queries when called in a loop.
 */
export type PlanDayTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isTrainingDay: boolean;
};

export const getPlanTargetForDate = async (
  clientId: string,
  date: string,
  includeActivityBurn?: boolean
): Promise<PlanDayTarget | null> => {
  // Resolve includeActivityBurn once if not passed by caller
  let burnFlag = includeActivityBurn;
  if (burnFlag === undefined) {
    const { data: clientRow } = await supabaseAdmin
      .from("clients").select("include_activity_burn").eq("id", clientId).single();
    burnFlag = clientRow?.include_activity_burn !== false;
  }

  const event = await getNutritionEventForDate(clientId, date);
  if (event) {
    return {
      calories: getTotalCalories(event, burnFlag),
      proteinG: event.proteinG,
      carbsG: event.carbG,
      fatG: event.fatG,
      isTrainingDay: event.isTrainingDay,
    };
  }

  // TODO NE-3-cleanup: remove template fallback once event coverage guaranteed
  return getPlanTargetForDateFromTemplate(clientId, date, burnFlag);
};

/** Template-based fallback: query plan by effective_from/until range + day-of-week. */
async function getPlanTargetForDateFromTemplate(
  clientId: string,
  date: string,
  includeActivityBurn: boolean
): Promise<PlanDayTarget | null> {
  const { data: plan, error: planError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .lte("effective_from", date)
    .or(`effective_until.gte.${date},effective_until.is.null`)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError || !plan) return null;

  const targetDate = new Date(date + "T00:00:00");
  const dayOfWeek = getDayOfWeekLowercase(targetDate);

  const { data: dailyTarget, error: dtError } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .select("calories, protein_g, carb_g, fat_g, is_training_day")
    .eq("nutrition_plan_id", plan.id)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (dtError || !dailyTarget) return null;

  let calories = dailyTarget.calories;

  if (includeActivityBurn) {
    const trainingPlan = await getActiveTrainingPlan(clientId);
    if (trainingPlan) {
      const trainingCalsByDay = getTrainingSessionCaloriesByDay(trainingPlan);
      const trainingCals = trainingCalsByDay[dayOfWeek] || 0;

      const dayActivities = getExternalActivitiesForDay(trainingPlan, dayOfWeek);
      const externalCals = calculateExternalActivityCalories(dayActivities);

      calories += trainingCals + externalCals;
    }
  }

  return {
    calories,
    proteinG: dailyTarget.protein_g,
    carbsG: dailyTarget.carb_g,
    fatG: dailyTarget.fat_g,
    isTrainingDay: dailyTarget.is_training_day,
  };
}
