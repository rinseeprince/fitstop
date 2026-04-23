import { supabaseAdmin } from "./supabase-admin";
import { getActiveTrainingPlan } from "./training-service";
import { countEventsInRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-event-service";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import { getTodayDateString, getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import type {
  CheckInTrainingContext,
  CheckInNutritionContext,
  DayOfWeek,
} from "@/types/check-in";
import { promoteNutritionPlanIfReady } from "./nutrition-plan-service";

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

  const trainingSessions = plan.sessions;

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
  // Promote planned plan if its effective date has arrived
  await promoteNutritionPlanIfReady(clientId);

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

  // Try event-based targets for the current week
  const today = getTodayDateString();
  const weekStart = getTrainingWeekStart(today);
  const weekEnd = getTrainingWeekEnd(today);

  const [events, { data: clientRow }] = await Promise.all([
    getNutritionEventsForDateRange(clientId, weekStart, weekEnd),
    supabaseAdmin.from("clients").select("include_activity_burn").eq("id", clientId).single(),
  ]);
  const includeActivityBurn = clientRow?.include_activity_burn !== false;

  let weeklyTargets: Array<{ day: DayOfWeek; dayLabel: string; isTrainingDay: boolean; calories: number; proteinG: number; carbsG: number; fatG: number }>;

  // Use event-based targets (all available events for the week)
  weeklyTargets = events.slice(0, 7).map((event) => {
    const display = mapNutritionEventToDisplayTarget(event, includeActivityBurn);
    return {
      day: display.day as DayOfWeek,
      dayLabel: display.dayLabel,
      isTrainingDay: display.isTrainingDay,
      calories: display.calories,
      proteinG: display.proteinG,
      carbsG: display.carbsG,
      fatG: display.fatG,
    };
  });

  const count = weeklyTargets.length || 1;
  const avgCalories = Math.round(weeklyTargets.reduce((sum, d) => sum + d.calories, 0) / count);
  const avgProteinG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.proteinG, 0) / count);
  const avgCarbsG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.carbsG, 0) / count);
  const avgFatG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.fatG, 0) / count);

  return {
    hasNutritionPlan: true,
    weeklyTargets,
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
  // Count completed sessions and planned events in parallel
  const [{ count, error }, sessionsPlanned] = await Promise.all([
    // completed_at is the date the session was completed (YYYY-MM-DD)
    // supabaseAdmin: client portal reading own session_logs (RLS exception 3)
    supabaseAdmin
      .from("session_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("completion_quality", "full")
      .gte("completed_at", periodStart)
      .lte("completed_at", periodEnd),
    countEventsInRange(clientId, periodStart, periodEnd),
  ]);

  if (error) {
    console.error("Error fetching session_logs for check-in:", error.message);
  }

  const sessionsCompleted = count ?? 0;

  return { sessionsCompleted, sessionsPlanned };
};
