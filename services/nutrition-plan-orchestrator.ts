import { getClientById } from "@/services/client-service";
import { generateNutritionPlan, calculateTDEE } from "@/services/nutrition-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  validateClientForNutrition,
} from "@/lib/validations/nutrition";
import { weightToKg, calculateDailyMacros } from "@/utils/nutrition-helpers";
import { createNutritionPlan } from "@/services/nutrition-plan-service";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { requirePhaseSelection } from "@/lib/require-phase-selection";
import type { GenerateNutritionPlanRequest, DietType } from "@/types/check-in";
import { deleteFutureNutritionEventsForPlan, regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
import { getTodayDateString } from "@/lib/date-helpers";

export class NutritionPlanError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "NutritionPlanError";
  }
}

interface PhaseCheckOk {
  phaseId: string | undefined;
  phaseGoalWeight?: number | null;
  phaseEndDate?: string | null;
  phaseStartDate?: string | null;
  phaseStatus?: string;
}

export interface NutritionPlanResult {
  success: true;
  goalSource: "phase" | "client";
  plan: Record<string, unknown>;
}

/**
 * Orchestrate creation of a nutrition plan (custom-macro or calculated).
 * Throws NutritionPlanError for validation / business-logic failures.
 */
export async function orchestrateNutritionPlanCreation(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  validatedData: { phaseId?: string; coachNotes?: string }
): Promise<NutritionPlanResult> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new NutritionPlanError("Client not found", 404);
  }
  if (client.coachId !== coachId) {
    throw new NutritionPlanError("Forbidden: You don't have access to this client", 403);
  }

  // Enforce phase selection when client has an active roadmap
  const phaseCheck = await requirePhaseSelection(clientId, validatedData.phaseId);
  if (!phaseCheck.ok) {
    throw new NutritionPlanError("Phase selection required", 400);
  }
  const phase: PhaseCheckOk = phaseCheck;

  // Nutrition plans can only be created for the active phase
  if (phase.phaseId && phase.phaseStatus !== "active") {
    throw new NutritionPlanError("Nutrition plans can only be created for the active phase", 400);
  }

  // Validate effectiveFrom date
  if (body.effectiveFrom) {
    if (body.effectiveFrom < getTodayDateString()) {
      throw new NutritionPlanError("Effective date cannot be in the past", 400);
    }
    if (phase.phaseId && phase.phaseEndDate && body.effectiveFrom > phase.phaseEndDate) {
      throw new NutritionPlanError(
        `Start date cannot be after the phase end date (${phase.phaseEndDate})`,
        400
      );
    }
  }

  const clientValidation = validateClientForNutrition(client);
  if (!clientValidation.valid) {
    throw new NutritionPlanError("Client missing required data for nutrition calculation", 400);
  }

  // Prefer new services, fall back to client.* for pre-migration clients
  const [latestMetrics, currentGoals] = await Promise.all([
    getLatestBodyMetrics(clientId),
    getCurrentGoals(clientId),
  ]);

  const currentWeight = latestMetrics?.weight ?? client.currentWeight;
  const weightUnit = (latestMetrics?.weightUnit ?? client.weightUnit ?? "lbs") as "lbs" | "kg";
  const bmr = latestMetrics?.bmr ?? client.bmr;
  const tdeeValue = latestMetrics?.tdee ?? client.tdee;
  const goalWeight = currentGoals?.goalWeight ?? client.goalWeight;

  // Phase goal overrides: use phase-specific goal if set, otherwise fall back to client goal
  const effectiveGoalWeightKg =
    phase.phaseGoalWeight != null
      ? phase.phaseGoalWeight // Already in kg, no conversion needed
      : goalWeight
        ? weightToKg(goalWeight, weightUnit)
        : null;
  const effectiveGoalDeadline =
    phase.phaseGoalWeight != null
      ? phase.phaseEndDate ?? null
      : body.goalDeadline || null;
  const effectiveStartDate =
    phase.phaseGoalWeight != null
      ? phase.phaseStartDate ?? null
      : null;
  const goalSource: "phase" | "client" =
    phase.phaseGoalWeight != null ? "phase" : "client";

  // Handle custom macros
  if (body.customMacrosEnabled) {
    return handleCustomMacros(
      clientId, coachId, body, phase, weightUnit, currentWeight,
      bmr, tdeeValue, effectiveGoalWeightKg, effectiveGoalDeadline,
      goalSource, validatedData
    );
  }

  // Generate calculated nutrition plan
  return handleCalculatedPlan(
    clientId, coachId, body, client, phase, weightUnit, currentWeight,
    bmr, effectiveGoalWeightKg, effectiveGoalDeadline, effectiveStartDate,
    goalSource, validatedData
  );
}

async function handleCustomMacros(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  phase: PhaseCheckOk,
  weightUnit: "lbs" | "kg",
  currentWeight: number | null | undefined,
  bmr: number | null | undefined,
  tdeeValue: number | null | undefined,
  effectiveGoalWeightKg: number | null,
  effectiveGoalDeadline: string | null,
  goalSource: "phase" | "client",
  validatedData: { coachNotes?: string }
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

  const trainingPlan = await getActiveTrainingPlan(clientId);

  // Capture old plan ID BEFORE the RPC archives it
  const { data: existingPlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

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
    trainingPlan,
    phaseId: phase.phaseId,
    coachNotes: validatedData.coachNotes,
    goalSource,
    effectiveFrom: body.effectiveFrom,
    dayCalorieOverrides: body.dayCalorieOverrides,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // Non-blocking: clean up old plan's future events, then generate for new plan
  if (existingPlan) {
    await deleteFutureNutritionEventsForPlan(existingPlan.id, body.effectiveFrom ?? undefined).catch((err) =>
      captureApiError(err, { action: "delete-future-nutrition-events", planId: existingPlan.id })
    );
  }
  await regenerateFutureNutritionEvents(clientId, newPlanId, body.effectiveFrom ?? undefined).catch((err) =>
    captureApiError(err, { action: "generate-nutrition-events", planId: newPlanId })
  );

  return {
    success: true,
    goalSource,
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
  phase: PhaseCheckOk,
  weightUnit: "lbs" | "kg",
  currentWeight: number | null | undefined,
  bmr: number | null | undefined,
  effectiveGoalWeightKg: number | null,
  effectiveGoalDeadline: string | null,
  effectiveStartDate: string | null,
  goalSource: "phase" | "client",
  validatedData: { coachNotes?: string }
): Promise<NutritionPlanResult> {
  const currentWeightKg = weightToKg(currentWeight!, weightUnit);

  const trainingPlan = await getActiveTrainingPlan(clientId);

  // Capture old plan BEFORE the RPC archives it (need id + baseline for preserveCalories)
  const { data: existingPlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, baseline_calories")
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
      trainingPlan,
      proteinTargetGPerKg: body.proteinTargetGPerKg,
      dietType: body.dietType,
      goalDeadline: effectiveGoalDeadline ?? undefined,
      startDate: effectiveStartDate ?? undefined,
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
    trainingPlan,
    phaseId: phase.phaseId,
    coachNotes: validatedData.coachNotes,
    goalSource,
    effectiveFrom: body.effectiveFrom,
    dayCalorieOverrides: body.dayCalorieOverrides,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // Non-blocking: clean up old plan's future events, then generate for new plan
  if (existingPlan) {
    await deleteFutureNutritionEventsForPlan(existingPlan.id, body.effectiveFrom ?? undefined).catch((err) =>
      captureApiError(err, { action: "delete-future-nutrition-events", planId: existingPlan.id })
    );
  }
  await regenerateFutureNutritionEvents(clientId, newPlanId, body.effectiveFrom ?? undefined).catch((err) =>
    captureApiError(err, { action: "generate-nutrition-events", planId: newPlanId })
  );

  return {
    success: true,
    goalSource,
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
