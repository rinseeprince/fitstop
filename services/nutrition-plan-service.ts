import { supabaseAdmin } from "./supabase-admin";
import { calculateDailyMacros, DAYS_OF_WEEK, getTrainingDays } from "@/utils/nutrition-helpers";
import { upsertWeeklySummary } from "@/services/weekly-nutrition-service";
import { getWeekStart, getTodayDateString } from "@/lib/date-helpers";
import type { DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import type { Database } from "@/types/database";

type NutritionPlanInsert = Database["public"]["Tables"]["nutrition_plans"]["Insert"];
type DailyTargetInsert = Database["public"]["Tables"]["nutrition_plan_daily_targets"]["Insert"];

export type CreateNutritionPlanParams = {
  clientId: string;
  coachId: string;
  workActivityLevel: string;
  trainingVolumeHours: string;
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalWeightKg: number | null;
  goalDeadline: string | null;
  baselineCalories: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  baseWeightKg: number;
  bmr: number | null;
  tdee: number | null;
  customMacrosEnabled: boolean;
  customCalories: number | null;
  customProteinG: number | null;
  customCarbG: number | null;
  customFatG: number | null;
  regenerationReason: string;
  trainingPlan: TrainingPlan | null;
};

/**
 * Create a new nutrition plan: archive any current active plan, insert a new
 * active plan with 7 daily target rows. Returns the new plan ID or null on error.
 */
export async function createNutritionPlan(params: CreateNutritionPlanParams): Promise<string | null> {
  const today = new Date().toISOString().split("T")[0];
  const yesterdayDate = new Date(today + "T00:00:00");
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split("T")[0];

  // 1. Archive current active plan (if any)
  // Set effective_until to yesterday to avoid date overlap with the new plan
  await supabaseAdmin
    .from("nutrition_plans")
    .update({
      status: "archived",
      effective_until: yesterday,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", params.clientId)
    .eq("status", "active");

  // 2. Insert new active plan
  const planInsert: NutritionPlanInsert = {
    client_id: params.clientId,
    coach_id: params.coachId,
    status: "active",
    effective_from: today,
    work_activity_level: params.workActivityLevel,
    training_volume_hours: params.trainingVolumeHours,
    protein_target_g_per_kg: params.proteinTargetGPerKg,
    diet_type: params.dietType,
    goal_weight_kg: params.goalWeightKg,
    goal_deadline: params.goalDeadline,
    baseline_calories: params.baselineCalories,
    protein_target_g: params.proteinTargetG,
    carb_target_g: params.carbTargetG,
    fat_target_g: params.fatTargetG,
    base_weight_kg: params.baseWeightKg,
    bmr: params.bmr,
    tdee: params.tdee,
    custom_macros_enabled: params.customMacrosEnabled,
    custom_calories: params.customCalories,
    custom_protein_g: params.customProteinG,
    custom_carb_g: params.customCarbG,
    custom_fat_g: params.customFatG,
    regeneration_reason: params.regenerationReason,
  };

  const { data: newPlan, error: insertError } = await supabaseAdmin
    .from("nutrition_plans")
    .insert(planInsert)
    .select("id")
    .single();

  if (insertError || !newPlan) {
    console.error("Error inserting nutrition plan:", insertError?.message);
    return null;
  }

  // Denormalize TDEE to client profile for overview display
  if (params.tdee != null) {
    await supabaseAdmin
      .from("clients")
      .update({ tdee: params.tdee })
      .eq("id", params.clientId);
  }

  // 3. Compute and insert 7 daily target rows
  const dailyTargets: DailyTargetInsert[] = [];

  if (params.customMacrosEnabled && params.customCalories != null) {
    for (const day of DAYS_OF_WEEK) {
      dailyTargets.push({
        nutrition_plan_id: newPlan.id,
        day_of_week: day,
        calories: params.customCalories,
        protein_g: params.customProteinG ?? params.proteinTargetG,
        carb_g: params.customCarbG ?? params.carbTargetG,
        fat_g: params.customFatG ?? params.fatTargetG,
        is_training_day: false,
      });
    }
  } else {
    const trainingDays = getTrainingDays(params.trainingPlan);

    for (const day of DAYS_OF_WEEK) {
      const baselineMacros = calculateDailyMacros(
        params.baselineCalories,
        params.proteinTargetG,
        trainingDays.has(day),
        params.dietType
      );

      dailyTargets.push({
        nutrition_plan_id: newPlan.id,
        day_of_week: day,
        calories: params.baselineCalories,
        protein_g: baselineMacros.proteinG,
        carb_g: baselineMacros.carbsG,
        fat_g: baselineMacros.fatG,
        is_training_day: trainingDays.has(day),
      });
    }
  }

  const { error: targetsError } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .insert(dailyTargets);

  if (targetsError) {
    console.error("Error inserting daily targets:", targetsError.message);
  }

  // Recalculate current week's summary with new plan targets (fire-and-forget)
  upsertWeeklySummary(params.clientId, getWeekStart(getTodayDateString())).catch((err) =>
    console.error("Weekly summary recalculation failed:", err instanceof Error ? err.message : "Unknown error")
  );

  return newPlan.id;
}
