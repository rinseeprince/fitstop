import { getClientById } from "@/services/client-service";
import { generateNutritionPlan, calculateTDEE } from "@/services/nutrition-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  validateClientForNutrition,
} from "@/lib/validations/nutrition";
import { weightToKg, calculateDailyMacros } from "@/utils/nutrition-helpers";
import {
  archiveNutritionPlan,
  createNutritionPlan,
  getActiveNutritionPlanId,
} from "@/services/nutrition-plan-service";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { getClientPhases } from "@/services/client-phases-service";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";
import {
  deleteFutureNutritionEventsForPlan,
  regenerateFutureNutritionEvents,
} from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
import { getClientTodayString } from "@/services/today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";

export class NutritionPlanError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "NutritionPlanError";
  }
}

/**
 * The events ARE the product of a regenerate — a failed rewrite must not
 * return success, or the coach sees a green toast over a stale/gapped
 * calendar. The plan row has already committed by this point, so the message
 * says so; a retry re-POST is idempotent (upsert on client_id,date; coach
 * edits protected by is_modified) and repairs any partial state.
 */
async function regenerateEventsOrThrow(
  clientId: string,
  planId: string,
  fromDate: string
): Promise<void> {
  try {
    // Plan creation/regeneration is open-ended forward from its effective date.
    await regenerateFutureNutritionEvents(clientId, planId, { kind: "from", from: fromDate });
  } catch (err) {
    captureApiError(err, { action: "generate-nutrition-events", planId });
    throw new NutritionPlanError(
      "Plan targets were saved, but calendar events failed to update. Regenerate the plan to retry.",
      500
    );
  }
}

export interface NutritionPlanResult {
  success: true;
  plan: Record<string, unknown>;
}

/**
 * Delete (archive) the client's durable nutrition plan and clear its upcoming
 * scheduled events so no orphaned prescription lingers on the calendar. Today
 * and past days are untouched; coach-edited (is_modified) FUTURE days go too,
 * deliberately — a deleted plan leaves no forward prescription.
 *
 * Events are cleared BEFORE the status flip so a mid-flight failure is
 * retryable: with the plan still active, a re-DELETE resolves it again and
 * repeats the (idempotent) event delete. Throws NutritionPlanError for
 * ownership / not-found failures.
 */
export async function orchestrateNutritionPlanDeletion(
  clientId: string,
  coachId: string
): Promise<{ planId: string }> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new NutritionPlanError("Client not found", 404);
  }
  if (client.coachId !== coachId) {
    throw new NutritionPlanError("Forbidden: You don't have access to this client", 403);
  }

  const planId = await getActiveNutritionPlanId(clientId);
  if (!planId) {
    throw new NutritionPlanError("No active nutrition plan to delete", 404);
  }

  // Client-local today anchors the cutoff on the client's calendar — never let
  // the event helper fall back to its UTC default. Delete strictly AFTER
  // today: nutrition events never leave 'scheduled' status, so a today the
  // client already part-logged would otherwise be deleted and the per-card
  // nutrition writer would 422 mid-day (no event, no active plan). The kept
  // event carries its own plan stamp, and the dialog's "Today and past days
  // are kept" stays literally true.
  const clientToday = await getClientTodayString(clientId);
  const deleteFrom = addDaysToDateString(clientToday, 1);

  await deleteFutureNutritionEventsForPlan(planId, deleteFrom);
  await archiveNutritionPlan(planId);

  return { planId };
}

/**
 * Orchestrate creation of a nutrition plan (custom-macro or calculated).
 * Throws NutritionPlanError for validation / business-logic failures.
 */
export async function orchestrateNutritionPlanCreation(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  validatedData: { coachNotes?: string }
): Promise<NutritionPlanResult> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new NutritionPlanError("Client not found", 404);
  }
  if (client.coachId !== coachId) {
    throw new NutritionPlanError("Forbidden: You don't have access to this client", 403);
  }

  // Client-local today (coach-tz fallback): both the past-date validation and
  // the goal resolver must agree with the RPC's active-vs-planned decision, or
  // a coach near local midnight gets a spurious "past date" rejection.
  const clientToday = await getClientTodayString(clientId);

  // Validate effectiveFrom date
  if (body.effectiveFrom) {
    if (body.effectiveFrom < clientToday) {
      throw new NutritionPlanError("Effective date cannot be in the past", 400);
    }
  }

  const clientValidation = validateClientForNutrition(client);
  if (!clientValidation.valid) {
    throw new NutritionPlanError("Client missing required data for nutrition calculation", 400);
  }

  // Prefer new services, fall back to client.* for pre-migration clients
  const [latestMetrics, currentGoals, phases] = await Promise.all([
    getLatestBodyMetrics(clientId),
    getCurrentGoals(clientId),
    getClientPhases(clientId),
  ]);

  const currentWeight = latestMetrics?.weight ?? client.currentWeight;
  const weightUnit = (latestMetrics?.weightUnit ?? client.weightUnit ?? "lbs") as "lbs" | "kg";
  const bmr = latestMetrics?.bmr ?? client.bmr;
  const tdeeValue = latestMetrics?.tdee ?? client.tdee;

  // The long-term client goal drives (Session 7.8's resolver). It performs the
  // single display→kg normalization (client goal weight is display units). The
  // deadline comes from this single scope — never the request body (the old
  // `body.goalDeadline` was the cross-scope source).
  // Anchored on the day this plan STARTS, not on today: a plan generated on
  // Friday to begin Monday must resolve against the block that covers Monday.
  const planStartDate = body.effectiveFrom ?? clientToday;
  const effective = resolveEffectiveGoal({
    weightUnit,
    clientGoal: {
      goalWeight: currentGoals?.goalWeight ?? client.goalWeight ?? null,
      goalBodyFatPercentage:
        currentGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage ?? null,
      deadline: currentGoals?.goalDeadline ?? client.goalDeadline ?? null,
      startDate: currentGoals?.goalStartDate ?? null,
    },
    today: clientToday,
    phases,
    date: planStartDate,
  });
  const effectiveGoalWeightKg = effective.goalWeightKg;
  const effectiveGoalDeadline = effective.deadline;
  const effectiveStartDate = effective.startDate;

  // Handle custom macros
  if (body.customMacrosEnabled) {
    return handleCustomMacros(
      clientId, coachId, body, weightUnit, currentWeight,
      bmr, tdeeValue, effectiveGoalWeightKg, effectiveGoalDeadline,
      validatedData, clientToday
    );
  }

  // Generate calculated nutrition plan
  return handleCalculatedPlan(
    clientId, coachId, body, client, weightUnit, currentWeight,
    bmr, effectiveGoalWeightKg, effectiveGoalDeadline, effectiveStartDate,
    validatedData, clientToday
  );
}

async function handleCustomMacros(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  weightUnit: "lbs" | "kg",
  currentWeight: number | null | undefined,
  bmr: number | null | undefined,
  tdeeValue: number | null | undefined,
  effectiveGoalWeightKg: number | null,
  effectiveGoalDeadline: string | null,
  validatedData: { coachNotes?: string },
  clientToday: string
): Promise<NutritionPlanResult> {
  if (!body.customProteinG || !body.customCarbG || !body.customFatG || !body.customCalories) {
    throw new NutritionPlanError("Custom macros enabled but values not provided", 400);
  }

  const calculatedCalories =
    body.customProteinG * 4 + body.customCarbG * 4 + body.customFatG * 9;
  const difference = Math.abs(body.customCalories - calculatedCalories);

  if (difference > CUSTOM_MACRO_CALORIE_TOLERANCE) {
    throw new NutritionPlanError(
      `Custom calories must be within ±50 calories of macro totals (calculated: ${calculatedCalories} cal)`,
      400
    );
  }

  const tdee = bmr
    ? calculateTDEE(bmr, body.workActivityLevel)
    : tdeeValue;

  const newPlanId = await createNutritionPlan({
    clientId,
    coachId,
    workActivityLevel: body.workActivityLevel,
    trainingVolumeHours: body.trainingVolumeHours || "2-3",
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
    goalWeightKg: effectiveGoalWeightKg,
    goalDeadline: effectiveGoalDeadline,
    baselineCalories: body.customCalories,
    proteinTargetG: body.customProteinG,
    carbTargetG: body.customCarbG,
    fatTargetG: body.customFatG,
    baseWeightKg: weightToKg(currentWeight!, weightUnit),
    bmr: bmr ?? null,
    tdee: tdee ?? null,
    customMacrosEnabled: true,
    customCalories: body.customCalories,
    customProteinG: body.customProteinG,
    customCarbG: body.customCarbG,
    customFatG: body.customFatG,
    regenerationReason: body.dayCalorieOverrides ? "custom_macros_custom_day_distribution" : "custom_macros",
    trainingPlan: null, // vestigial param (createNutritionPlan ignores it)
    coachNotes: validatedData.coachNotes,
    effectiveFrom: body.effectiveFrom,
    dayCalorieOverrides: body.dayCalorieOverrides,
    // A fresh custom-macro plan establishes a new baseline at the current
    // weight -> re-stamp the banner snapshot.
    recalcSnapshots: true,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // In-place durable plan: the RPC upserts the single active plan (stable id),
  // so we regenerate its future events from one client-local anchor. No
  // separate old-plan cleanup — there is no old plan to delete.
  await regenerateEventsOrThrow(clientId, newPlanId, body.effectiveFrom ?? clientToday);

  return {
    success: true,
    plan: {
      calorieTarget: body.customCalories,
      proteinTargetG: body.customProteinG,
      carbTargetG: body.customCarbG,
      fatTargetG: body.customFatG,
      adjustedTdee: tdee ?? tdeeValue!,
      weeklyWeightChangeKg: 0,
      warnings: [],
    },
  };
}

async function handleCalculatedPlan(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  client: NonNullable<Awaited<ReturnType<typeof getClientById>>>,
  weightUnit: "lbs" | "kg",
  currentWeight: number | null | undefined,
  bmr: number | null | undefined,
  effectiveGoalWeightKg: number | null,
  effectiveGoalDeadline: string | null,
  // Always a concrete date — resolveEffectiveGoal falls back to `today`.
  effectiveStartDate: string,
  validatedData: { coachNotes?: string },
  clientToday: string
): Promise<NutritionPlanResult> {
  const currentWeightKg = weightToKg(currentWeight!, weightUnit);

  // Read the existing active plan's baseline: preserveCalories reuses it, and
  // its presence distinguishes an "initial" plan from a "regenerated" one.
  const { data: existingPlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("baseline_calories")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  let plan: import("@/services/nutrition-service").NutritionPlan;
  let regenerationReason: string;

  if (body.preserveCalories) {
    if (!existingPlan) {
      throw new NutritionPlanError("No active nutrition plan to preserve calories from", 400);
    }
    // Skip TDEE calculation — reuse existing baseline calories with new training day distribution
    const baselineCalories = existingPlan.baseline_calories;
    const proteinG = Math.round(currentWeightKg * body.proteinTargetGPerKg);
    const macros = calculateDailyMacros(baselineCalories, proteinG, false, body.dietType);
    plan = {
      baselineCalories,
      tdee: bmr ? calculateTDEE(bmr, body.workActivityLevel) : 0,
      calorieTarget: baselineCalories,
      proteinTargetG: macros.proteinG,
      carbTargetG: macros.carbsG,
      fatTargetG: macros.fatG,
      adjustedTdee: bmr ? calculateTDEE(bmr, body.workActivityLevel) : 0,
      weeklyWeightChangeKg: 0,
      requiredDailyDeficit: 0,
      warnings: [],
    };
    regenerationReason = "regenerated_preserved_calories";
  } else {
    plan = generateNutritionPlan({
      currentWeightKg,
      goalWeightKg: effectiveGoalWeightKg ?? undefined,
      bmr: bmr!,
      gender: client.gender as "male" | "female" | "other",
      workActivityLevel: body.workActivityLevel,
      trainingVolumeHours: body.trainingVolumeHours,
      trainingPlan: null, // vestigial param (generateNutritionPlan ignores it)
      proteinTargetGPerKg: body.proteinTargetGPerKg,
      dietType: body.dietType,
      goalDeadline: effectiveGoalDeadline ?? undefined,
      startDate: effectiveStartDate ?? undefined,
      today: clientToday,
      weightUnit: weightUnit,
    });
    regenerationReason = existingPlan
      ? (body.dayCalorieOverrides ? "regenerated_custom_day_distribution" : "regenerated")
      : "initial";
  }

  const newPlanId = await createNutritionPlan({
    clientId,
    coachId,
    workActivityLevel: body.workActivityLevel,
    trainingVolumeHours: body.trainingVolumeHours || "2-3",
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
    goalWeightKg: effectiveGoalWeightKg,
    goalDeadline: effectiveGoalDeadline,
    baselineCalories: plan.baselineCalories,
    proteinTargetG: plan.proteinTargetG,
    carbTargetG: plan.carbTargetG,
    fatTargetG: plan.fatTargetG,
    baseWeightKg: currentWeightKg,
    bmr: bmr ?? null,
    tdee: plan.tdee,
    customMacrosEnabled: false,
    customCalories: null,
    customProteinG: null,
    customCarbG: null,
    customFatG: null,
    regenerationReason,
    trainingPlan: null, // vestigial param (createNutritionPlan ignores it)
    coachNotes: validatedData.coachNotes,
    effectiveFrom: body.effectiveFrom,
    dayCalorieOverrides: body.dayCalorieOverrides,
    // A fresh recompute re-stamps the banner snapshot; a preserve-calories
    // regen keeps the existing calories (not a recompute), so it must NOT
    // re-stamp base_weight_kg or the banner would wrongly silence (spec section 9).
    recalcSnapshots: !body.preserveCalories,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // In-place durable plan: the RPC upserts the single active plan (stable id),
  // so we regenerate its future events from one client-local anchor. No
  // separate old-plan cleanup — there is no old plan to delete.
  await regenerateEventsOrThrow(clientId, newPlanId, body.effectiveFrom ?? clientToday);

  return {
    success: true,
    plan: {
      baselineCalories: plan.baselineCalories,
      tdee: plan.tdee,
      calorieTarget: plan.calorieTarget,
      proteinTargetG: plan.proteinTargetG,
      carbTargetG: plan.carbTargetG,
      fatTargetG: plan.fatTargetG,
      adjustedTdee: plan.adjustedTdee,
      weeklyWeightChangeKg: plan.weeklyWeightChangeKg,
      requiredDailyDeficit: plan.requiredDailyDeficit,
      warnings: plan.warnings,
    },
  };
}
