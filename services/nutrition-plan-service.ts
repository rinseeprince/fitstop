import { supabaseAdmin } from "./supabase-admin";
import { calculateDailyMacros, DAYS_OF_WEEK, getTrainingDays } from "@/utils/nutrition-helpers";
import { upsertWeeklySummary } from "@/services/weekly-nutrition-service";
import { getWeekStart, getTodayDateString } from "@/lib/date-helpers";
import type { DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import { recordBodyMetrics } from "@/services/body-metrics-service";
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
  phaseId?: string;
};

/**
 * Create a new nutrition plan: archive any current active plan, insert a new
 * active plan with 7 daily target rows in a single database transaction.
 * Returns the new plan ID or null on error.
 */
export async function createNutritionPlan(params: CreateNutritionPlanParams): Promise<string | null> {
  // Compute daily target rows before calling the atomic RPC
  const dailyTargets: { day_of_week: string; calories: number; protein_g: number; carb_g: number; fat_g: number; is_training_day: boolean }[] = [];

  if (params.customMacrosEnabled && params.customCalories != null) {
    for (const day of DAYS_OF_WEEK) {
      dailyTargets.push({
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
        day_of_week: day,
        calories: params.baselineCalories,
        protein_g: baselineMacros.proteinG,
        carb_g: baselineMacros.carbsG,
        fat_g: baselineMacros.fatG,
        is_training_day: trainingDays.has(day),
      });
    }
  }

  // Single transactional RPC: archive old plan + insert new plan + insert daily targets
  // RPC function defined in migration 048 - type will be generated after migration runs
  const { data: newPlanId, error: rpcError } = await supabaseAdmin
    .rpc("create_nutrition_plan_atomic" as never, {
      p_client_id: params.clientId,
      p_coach_id: params.coachId,
      p_work_activity_level: params.workActivityLevel,
      p_training_volume_hours: params.trainingVolumeHours,
      p_protein_target_g_per_kg: params.proteinTargetGPerKg,
      p_diet_type: params.dietType,
      p_goal_weight_kg: params.goalWeightKg,
      p_goal_deadline: params.goalDeadline,
      p_baseline_calories: params.baselineCalories,
      p_protein_target_g: params.proteinTargetG,
      p_carb_target_g: params.carbTargetG,
      p_fat_target_g: params.fatTargetG,
      p_base_weight_kg: params.baseWeightKg,
      p_bmr: params.bmr,
      p_tdee: params.tdee,
      p_custom_macros_enabled: params.customMacrosEnabled,
      p_custom_calories: params.customCalories,
      p_custom_protein_g: params.customProteinG,
      p_custom_carb_g: params.customCarbG,
      p_custom_fat_g: params.customFatG,
      p_regeneration_reason: params.regenerationReason,
      p_daily_targets: dailyTargets,
      p_phase_id: params.phaseId || null,
    } as never) as unknown as { data: string | null; error: { message: string } | null };

  if (rpcError || !newPlanId) {
    console.error("Error creating nutrition plan:", rpcError?.message);
    return null;
  }

  // Denormalize TDEE to client profile for overview display (non-transactional, safe to fail)
  if (params.tdee != null) {
    await supabaseAdmin
      .from("clients")
      .update({ tdee: params.tdee })
      .eq("id", params.clientId);
  }

  // Dual-write TDEE to body_metrics (non-blocking)
  if (params.tdee != null) {
    try {
      await recordBodyMetrics({
        clientId: params.clientId,
        tdee: params.tdee,
        bmr: params.bmr ?? undefined,
        source: "nutrition_plan",
        sourceId: newPlanId,
      });
    } catch (dualWriteError) {
      console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
    }
  }

  // Recalculate current week's summary with new plan targets (fire-and-forget)
  upsertWeeklySummary(params.clientId, getWeekStart(getTodayDateString())).catch((err) =>
    console.error("Weekly summary recalculation failed:", err instanceof Error ? err.message : "Unknown error")
  );

  return newPlanId;
}
