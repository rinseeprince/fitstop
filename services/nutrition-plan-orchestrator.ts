import { getClientById } from "@/services/client-service";
import { generateNutritionPlan, calculateTDEE } from "@/services/nutrition-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  validateClientForNutrition,
} from "@/lib/validations/nutrition";
import { weightToKg } from "@/utils/nutrition-helpers";
import { createNutritionPlan } from "@/services/nutrition-plan-service";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { requirePhaseSelection } from "@/lib/require-phase-selection";
import type { GenerateNutritionPlanRequest, DietType } from "@/types/check-in";

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
    regenerationReason: "custom_macros",
    trainingPlan,
    phaseId: phase.phaseId,
    coachNotes: validatedData.coachNotes,
    goalSource,
    effectiveFrom: body.effectiveFrom,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

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

  const plan = generateNutritionPlan({
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

  // Check if client already has an active plan (for regeneration_reason)
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
    regenerationReason: existingPlan ? "regenerated" : "initial",
    trainingPlan,
    phaseId: phase.phaseId,
    coachNotes: validatedData.coachNotes,
    goalSource,
    effectiveFrom: body.effectiveFrom,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

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
