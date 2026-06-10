import { supabaseAdmin } from "./supabase-admin";
import { calculateDailyMacros, DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { DietType, DayCalorieOverrides } from "@/types/check-in";
import type { DayOfWeek } from "@/utils/nutrition-helpers";
import type { TrainingPlan } from "@/types/training";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { getDateString } from "@/lib/date-helpers";
import { getClientTodayString } from "@/services/today-service";
import { deleteFutureNutritionEventsForPlan, regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
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
  coachNotes?: string;
  goalSource?: "phase" | "client";
  effectiveFrom?: string;
  dayCalorieOverrides?: DayCalorieOverrides;
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
    // is_training_day is stored for schema compatibility but is no longer the
    // source of truth for the training/rest badge. The badge is derived per
    // day-of-week from live training_events at read time in
    // buildDailyTargetsFromPlan — see that function's `day in surplusByDay`
    // check. Writing false here is safe because calculateDailyMacros ignores
    // the isTrainingDay arg (see the underscore prefix on its parameter).
    for (const day of DAYS_OF_WEEK) {
      const baselineMacros = calculateDailyMacros(
        params.baselineCalories,
        params.proteinTargetG,
        false,
        params.dietType
      );

      dailyTargets.push({
        day_of_week: day,
        calories: params.baselineCalories,
        protein_g: baselineMacros.proteinG,
        carb_g: baselineMacros.carbsG,
        fat_g: baselineMacros.fatG,
        is_training_day: false,
      });
    }
  }

  // Apply custom day distribution overrides if provided
  if (params.dayCalorieOverrides) {
    for (const target of dailyTargets) {
      const override = params.dayCalorieOverrides[target.day_of_week as DayOfWeek];
      if (override) {
        target.calories = override.calories;
        target.protein_g = override.protein_g;
        target.carb_g = override.carbs_g;
        target.fat_g = override.fat_g;
      }
    }
  }

  // Client-local today (coach-tz fallback) — computed here, not threaded from
  // callers, so every placement path judges active-vs-planned correctly.
  const pToday = await getClientTodayString(params.clientId);

  // Single transactional RPC: archive old plan + insert new plan + insert daily targets
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
      p_coach_notes: params.coachNotes || null,
      p_goal_source: params.goalSource || null,
      p_effective_from: params.effectiveFrom || null,
      p_today: pToday,
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

  return newPlanId;
}

/**
 * Lazy promotion: if a planned nutrition plan's effective_from has arrived,
 * promote it to active and archive the current active plan.
 * Called before any read of the active nutrition plan.
 *
 * supabaseAdmin: system-level write for plan lifecycle management.
 */
export async function promoteNutritionPlanIfReady(
  clientId: string,
  clientToday?: string
): Promise<{ promoted: boolean; newPlanId?: string }> {
  // Client-local today: a plan effective "today" must promote when the
  // CLIENT's day arrives, not the server's UTC day. Also the anchor for the
  // delete/regen pair below. Callers that already resolved the client-local
  // today pass it in to avoid a redundant fetch.
  const today = clientToday ?? (await getClientTodayString(clientId));

  const { data: plannedPlan, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from")
    .eq("client_id", clientId)
    .eq("status", "planned")
    .lte("effective_from", today)
    .maybeSingle();

  if (error || !plannedPlan) return { promoted: false };

  // Capture old active plan ID BEFORE archiving it
  const { data: oldActivePlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  // Archive the current active plan
  const archiveUntil = new Date(plannedPlan.effective_from + "T00:00:00");
  archiveUntil.setDate(archiveUntil.getDate() - 1);
  const archiveUntilStr = getDateString(archiveUntil);

  await supabaseAdmin
    .from("nutrition_plans")
    .update({
      status: "archived",
      effective_until: archiveUntilStr,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("status", "active");

  // Promote planned → active (clear effective_until so the active plan has open-ended coverage)
  await supabaseAdmin
    .from("nutrition_plans")
    .update({
      status: "active",
      effective_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", plannedPlan.id);

  // Clean up old plan's future events, generate for promoted plan. Pass the
  // SAME anchor date to both: a dateless delete falls back to UTC while a
  // dateless regen falls back to client-local today, and a mismatched pair
  // anchors the cleanup and the regeneration on different days.
  if (oldActivePlan) {
    await deleteFutureNutritionEventsForPlan(oldActivePlan.id, today).catch((err) =>
      captureApiError(err, { action: "delete-future-nutrition-events-promote", planId: oldActivePlan.id })
    );
  }
  await regenerateFutureNutritionEvents(clientId, plannedPlan.id, today).catch((err) =>
    captureApiError(err, { action: "generate-nutrition-events-promote", planId: plannedPlan.id })
  );

  return { promoted: true, newPlanId: plannedPlan.id };
}

/**
 * Returns the id of the client's currently active nutrition plan, or null.
 *
 * Pure read — no promotion side-effect (callers that need lazy promotion call
 * `promoteNutritionPlanIfReady` first). Mirrors the active-plan resolution inlined in
 * `client-portal-service` and the activation-readiness route. Used by
 * `resolvePlanContextForDate` to stamp `nutrition_logs.nutrition_plan_id` on days with
 * no nutrition event.
 */
export async function getActiveNutritionPlanId(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch active nutrition plan: ${error.message}`);
  }
  return data?.id ?? null;
}
