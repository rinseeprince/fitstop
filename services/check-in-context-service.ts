import { supabaseAdmin } from "./supabase-admin";
import { getActiveTrainingPlan } from "./training-service";
import { getWeeklyNutritionTargets } from "@/utils/nutrition-helpers";
import type {
  CheckInTrainingContext,
  CheckInNutritionContext,
  DayOfWeek,
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
  // Get client with nutrition data
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "calorie_target, protein_target_g, carb_target_g, fat_target_g, diet_type"
    )
    .eq("id", clientId)
    .single();

  const client = data as {
    calorie_target: number | null;
    protein_target_g: number | null;
    carb_target_g: number | null;
    fat_target_g: number | null;
    diet_type: string | null;
  } | null;

  if (error || !client || !client.calorie_target) {
    return { hasNutritionPlan: false };
  }

  // Get active training plan for training day detection
  const plan = await getActiveTrainingPlan(clientId);

  // Calculate weekly targets
  const dietType = (client.diet_type || "balanced") as "balanced" | "high_carb" | "low_carb" | "keto" | "custom";
  const weeklyTargets = getWeeklyNutritionTargets(
    client.calorie_target,
    client.protein_target_g || 150,
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
