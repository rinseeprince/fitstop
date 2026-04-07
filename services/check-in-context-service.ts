import { supabaseAdmin } from "./supabase-admin";
import { getActiveTrainingPlan } from "./training-service";
import { getWeeklyNutritionTargets } from "@/utils/nutrition-helpers";
import { countPlannedSessions } from "@/utils/training-week-helpers";
import type {
  CheckInTrainingContext,
  CheckInNutritionContext,
  DayOfWeek,
  DietType,
} from "@/types/check-in";

/**
 * Get training context for the check-in form
 * Returns the active training plan's sessions and exercises
 */
export const getCheckInTrainingContext = async (
  clientId: string
): Promise<CheckInTrainingContext> => {
  const plan = await getActiveTrainingPlan(clientId);

  if (!plan) {
    return { hasActivePlan: false, sessions: [] };
  }

  // Filter to only training sessions (not external activities)
  const trainingSessions = plan.sessions.filter(
    (s) => s.sessionType === "training"
  );

  return {
    hasActivePlan: true,
    planId: plan.id,
    planName: plan.name,
    sessions: trainingSessions.map((s) => ({
      id: s.id,
      name: s.name,
      dayOfWeek: s.dayOfWeek as DayOfWeek | undefined,
      focus: s.focus,
      exercises: s.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        sets: e.sets,
        repsTarget: e.repsTarget || (e.repsMin && e.repsMax
          ? `${e.repsMin}-${e.repsMax}`
          : e.repsMin?.toString()),
      })),
    })),
  };
};

/**
 * Get nutrition context for the check-in form
 * Returns the client's nutrition targets for display
 */
export const getCheckInNutritionContext = async (
  clientId: string
): Promise<CheckInNutritionContext> => {
  // TODO: nutrition_plans has client RLS SELECT policies — could use a server
  // client here instead of supabaseAdmin. Keeping admin for now to avoid
  // refactoring the function signature across all callers.
  const { data: nutritionPlan, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("baseline_calories, protein_target_g, carb_target_g, fat_target_g, diet_type")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !nutritionPlan || !nutritionPlan.baseline_calories) {
    return { hasNutritionPlan: false };
  }

  // Get active training plan for training day detection
  const plan = await getActiveTrainingPlan(clientId);

  // Calculate weekly targets
  const dietType = (nutritionPlan.diet_type || "balanced") as DietType;
  const weeklyTargets = getWeeklyNutritionTargets(
    nutritionPlan.baseline_calories,
    nutritionPlan.protein_target_g || 150,
    plan,
    dietType
  );

  // Calculate average targets
  const avgCalories = Math.round(
    weeklyTargets.reduce((sum, d) => sum + d.calories, 0) / 7
  );
  const avgProteinG = Math.round(
    weeklyTargets.reduce((sum, d) => sum + d.proteinG, 0) / 7
  );
  const avgCarbsG = Math.round(
    weeklyTargets.reduce((sum, d) => sum + d.carbsG, 0) / 7
  );
  const avgFatG = Math.round(
    weeklyTargets.reduce((sum, d) => sum + d.fatG, 0) / 7
  );

  return {
    hasNutritionPlan: true,
    weeklyTargets: weeklyTargets.map((d) => ({
      day: d.day as DayOfWeek,
      dayLabel: d.dayLabel,
      isTrainingDay: d.isTrainingDay,
      calories: d.calories,
      proteinG: d.proteinG,
      carbsG: d.carbsG,
      fatG: d.fatG,
    })),
    averageTargets: {
      calories: avgCalories,
      proteinG: avgProteinG,
      carbsG: avgCarbsG,
      fatG: avgFatG,
    },
  };
};

export type CheckInTrainingPeriodStats = {
  sessionsCompleted: number;
  sessionsPlanned: number;
};

/**
 * Get training session stats for the check-in period using session_logs
 * (same source of truth as the coach-side training hero).
 */
export const getCheckInTrainingPeriodStats = async (
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<CheckInTrainingPeriodStats> => {
  const plan = await getActiveTrainingPlan(clientId);

  if (!plan) {
    return { sessionsCompleted: 0, sessionsPlanned: 0 };
  }

  // Count completed sessions from session_logs in the period
  // completed_at is the date the session was completed (YYYY-MM-DD)
  // supabaseAdmin: client portal reading own session_logs (RLS exception 3)
  const { count, error } = await supabaseAdmin
    .from("session_logs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("completion_quality", "full")
    .gte("completed_at", periodStart)
    .lte("completed_at", periodEnd);

  if (error) {
    console.error("Error fetching session_logs for check-in:", error.message);
  }

  const sessionsCompleted = count ?? 0;

  // Count planned sessions in the period using same utility as coach-side hero
  const sessionsPlanned = countPlannedSessions(
    plan.sessions.map((s) => ({ dayOfWeek: s.dayOfWeek, sessionType: s.sessionType })),
    periodStart,
    periodEnd
  );

  return { sessionsCompleted, sessionsPlanned };
};
