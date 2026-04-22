/**
 * Daily Context Service
 * Provides today's training sessions, planned activities, and nutrition targets
 * for use in daily log entry and context display.
 */

import { supabaseAdmin } from "./supabase-admin";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getClientTrainingPlan } from "./client-portal-training";
import { getDayOfWeekLowercase } from "./daily-logs-service";
import { getEventForDate } from "./training-event-service";
import { getTodayDateString } from "@/lib/date-helpers";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getTotalCalories, mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { TodaysActivity } from "@/types/daily-pulse";

type TodaysTrainingSession = {
  sessionId: string;
  sessionName: string;
  estimatedCalories: number;
} | null;

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

  if (!event) return null;

  const { data: clientRow } = await supabaseAdmin
    .from("clients").select("include_activity_burn").eq("id", clientId).single();
  const includeActivityBurn = clientRow?.include_activity_burn !== false;
  const target = mapNutritionEventToDisplayTarget(event, includeActivityBurn);
  return { ...target, planId: event.nutritionPlanId, includeActivityBurn };
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
  if (!event) return null;

  return {
    calories: getTotalCalories(event, burnFlag),
    proteinG: event.proteinG,
    carbsG: event.carbG,
    fatG: event.fatG,
    isTrainingDay: event.isTrainingDay,
  };
};
