import { supabaseAdmin } from "./supabase-admin";
import { coversDate } from "./training-plan-window";
import { calculateDailyMacros, DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import type { Database } from "@/types/database";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { getClientTodayString } from "@/services/today-service";

type NutritionPlanRow = Database["public"]["Tables"]["nutrition_plans"]["Row"];

export type CreateNutritionPlanParams = {
  clientId: string;
  coachId: string;
  /**
   * The client-local today the ROUTE's past-date guard judged against —
   * threaded, never recomputed here. The RPC's belt raises when
   * effectiveFrom < p_today, so a second getClientTodayString call straddling
   * client midnight would make a route-accepted save fail in the RPC with a
   * generic error. Single source: orchestrator :166 → calcInputs.today → here.
   */
  clientToday: string;
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
  effectiveFrom?: string;
};

/**
 * Save a nutrition plan VERSION (migration 144, close-and-insert — one
 * transaction). Three branches on the client's open version: none → insert;
 * open starts before the new date → close it at new_start − 1 and insert;
 * open starts on/after → absorb it in place (same-day re-saves collapse,
 * saving earlier than a queued change replaces it). A universal sweep removes
 * fully-replaced queued versions and re-closes any straddler, so windows can
 * never overlap. Returns the surviving version's id or null on error.
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

  // Single transactional RPC: close/absorb the open version + insert/update
  // the new version + replace its daily-target grid (migration 144).
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
      p_effective_from: params.effectiveFrom || null,
      p_today: params.clientToday,
      // NOTE: this object is cast `as never`, so TypeScript checks NOTHING
      // about it. A key that no longer exists on the function makes PostgREST
      // unable to resolve the overload (PGRST202), rpcError is set below, this
      // returns null, and EVERY plan save fails with "Failed to create
      // nutrition plan" — while tsc, eslint and vitest all stay green. Keep
      // these keys in exact sync with the RPC signature (migration 144).
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
 * Thin covering-today wrapper over `getNutritionPlanIdForDate` — the id of
 * the version governing the client's current calendar day, or null (a client
 * whose only versions are queued or ended resolves null). Kept per the
 * versioning design as the canonical "what governs today" entry point (the
 * training twin is `getActiveTrainingPlanId`); the 1b.2 rewiring left it with
 * no production callers, so any new caller should first check whether a
 * per-date resolution fits better.
 */
export async function getActiveNutritionPlanId(clientId: string): Promise<string | null> {
  return getNutritionPlanIdForDate(clientId, await getClientTodayString(clientId));
}

/**
 * The version whose [effective_from, effective_until] window covers `date` —
 * the nutrition twin of `getTrainingPlanForDate`, sharing `coversDate` so the
 * two tracks can never disagree about the window predicate. The status half is
 * a plain `.eq("status", "active")`, deliberately simpler than training's
 * `.neq("status", "archived")`: nutrition has only the two coach-act statuses
 * (active | archived) and no `deleted_at` — do not "unify" the two filters.
 * Ordering matches training (`effective_from DESC, created_at DESC`) so every
 * resolver picks the same row on a tie.
 */
export async function getNutritionPlanForDate(
  clientId: string,
  date: string
): Promise<NutritionPlanRow | null> {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("nutrition_plans")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "active"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve nutrition plan for date: ${error.message}`);
  }
  return data;
}

/**
 * Id-only twin of `getNutritionPlanForDate` for hot per-write paths (the
 * daily-log stamp fallback) that must not pay for the full row.
 * `.maybeSingle()` so no covering version resolves to null, never a throw.
 */
export async function getNutritionPlanIdForDate(
  clientId: string,
  date: string
): Promise<string | null> {
  const { data, error } = await coversDate(
    supabaseAdmin
      .from("nutrition_plans")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "active"),
    date
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve nutrition plan id for date: ${error.message}`);
  }
  return data?.id ?? null;
}

export type NutritionPlanVersionWindow = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

/**
 * Every ACTIVE version whose window overlaps [rangeStart, rangeEnd], earliest
 * first. The version-segmentation primitive: the training cascade maps each
 * date in its scope to the version covering it (the schedule-data windowed
 * query shape), and the bulk reset groups its date list the same way. Overlap
 * is `effective_from <= rangeEnd AND (effective_until >= rangeStart OR open)`.
 */
export async function getActiveNutritionPlanVersionsOverlapping(
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<NutritionPlanVersionWindow[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from, effective_until")
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("effective_from", rangeEnd)
    .or(`effective_until.gte.${rangeStart},effective_until.is.null`)
    .order("effective_from", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch nutrition plan versions: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
  }));
}

/** Pure window test shared by the in-memory date→version mappers. */
export function versionCoversDate(v: NutritionPlanVersionWindow, date: string): boolean {
  return v.effectiveFrom <= date && (v.effectiveUntil === null || v.effectiveUntil >= date);
}

export type NextFutureNutritionPlan = {
  id: string;
  effectiveFrom: string;
};

/**
 * The earliest version starting strictly after `today` — the window-flipped
 * twin of `getNutritionPlanForDate`, mirroring `getNextFutureTrainingPlan`.
 * Earliest first so a chain of queued changes reports the NEXT one; tiebreak
 * on `created_at DESC` so a correction saved over a queued version for the
 * same start date is the one announced.
 */
export async function getNextFutureNutritionPlan(
  clientId: string,
  today: string
): Promise<NextFutureNutritionPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, effective_from")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gt("effective_from", today)
    .order("effective_from", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve next future nutrition plan: ${error.message}`);
  }
  return data ? { id: data.id, effectiveFrom: data.effective_from } : null;
}
