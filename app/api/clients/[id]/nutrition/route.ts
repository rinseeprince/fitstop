import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { generateNutritionPlan, calculateTDEE } from "@/services/nutrition-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit, coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  nutritionPlanSchema,
  nutritionSettingsPatchSchema,
  validateClientForNutrition,
} from "@/lib/validations/nutrition";
import { weightToKg } from "@/utils/nutrition-helpers";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import { createNutritionPlan } from "@/services/nutrition-plan-service";
import type { ClientUpdate } from "@/lib/database-helpers";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import type { GenerateNutritionPlanRequest, DietType } from "@/types/check-in";
import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { requirePhaseSelection } from "@/lib/require-phase-selection";

/**
 * GET: Return the active nutrition plan + daily targets for the coach view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const includeActivityBurn = client.includeActivityBurn ?? true;

    // Fetch active plan
    const { data: plan } = await supabaseAdmin
      .from("nutrition_plans")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json({ success: true, hasPlan: false });
    }

    // Fetch daily targets
    const { data: dailyTargetRows } = await supabaseAdmin
      .from("nutrition_plan_daily_targets")
      .select("*")
      .eq("nutrition_plan_id", plan.id);

    // Fetch training plan for live calorie enrichment
    const trainingPlan = await getActiveTrainingPlan(clientId);
    const dietType = (plan.diet_type as DietType) || "balanced";

    const dailyTargets = buildDailyTargetsFromPlan(
      plan,
      dailyTargetRows,
      trainingPlan,
      includeActivityBurn,
      dietType
    );

    return NextResponse.json({
      calorieTarget: plan.custom_macros_enabled && plan.custom_calories ? plan.custom_calories : plan.baseline_calories,
      proteinTargetG: plan.protein_target_g,
      carbTargetG: plan.carb_target_g,
      fatTargetG: plan.fat_target_g,
      baselineCalories: plan.baseline_calories,
      customMacrosEnabled: plan.custom_macros_enabled,
      customCalories: plan.custom_calories,
      customProteinG: plan.custom_protein_g,
      customCarbG: plan.custom_carb_g,
      customFatG: plan.custom_fat_g,
      dietType: plan.diet_type,
      includeActivityBurn,
      dailyTargets,
    });
  } catch (error) {
    console.error("Error fetching nutrition plan:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ success: false, error: "Failed to fetch nutrition plan" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body: GenerateNutritionPlanRequest = await request.json();
    const validationResult = nutritionPlanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    // Enforce phase selection when client has an active roadmap
    const phaseCheck = await requirePhaseSelection(clientId, validationResult.data.phaseId);
    if (!phaseCheck.ok) return phaseCheck.response;

    // Nutrition plans can only be created for the active phase
    if (phaseCheck.phaseId && phaseCheck.phaseStatus !== "active") {
      return NextResponse.json(
        { success: false, error: "Nutrition plans can only be created for the active phase" },
        { status: 400 }
      );
    }

    const clientValidation = validateClientForNutrition(client);
    if (!clientValidation.valid) {
      return NextResponse.json(
        { success: false, error: "Client missing required data for nutrition calculation" },
        { status: 400 }
      );
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
      phaseCheck.phaseGoalWeight != null
        ? phaseCheck.phaseGoalWeight // Already in kg, no conversion needed
        : goalWeight
          ? weightToKg(goalWeight, weightUnit)
          : null;
    const effectiveGoalDeadline =
      phaseCheck.phaseGoalWeight != null
        ? phaseCheck.phaseEndDate ?? null
        : body.goalDeadline || null;
    const effectiveStartDate =
      phaseCheck.phaseGoalWeight != null
        ? phaseCheck.phaseStartDate ?? null
        : null;
    const goalSource: "phase" | "client" =
      phaseCheck.phaseGoalWeight != null ? "phase" : "client";

    // Handle custom macros
    if (body.customMacrosEnabled) {
      if (!body.customProteinG || !body.customCarbG || !body.customFatG || !body.customCalories) {
        return NextResponse.json(
          { success: false, error: "Custom macros enabled but values not provided" },
          { status: 400 }
        );
      }

      const calculatedCalories =
        body.customProteinG * 4 + body.customCarbG * 4 + body.customFatG * 9;
      const difference = Math.abs(body.customCalories - calculatedCalories);

      if (difference > CUSTOM_MACRO_CALORIE_TOLERANCE) {
        return NextResponse.json(
          { success: false, error: `Custom calories must be within ±50 calories of macro totals (calculated: ${calculatedCalories} cal)` },
          { status: 400 }
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
        phaseId: phaseCheck.phaseId,
        coachNotes: validationResult.data.coachNotes,
        goalSource,
      });

      if (!newPlanId) {
        return NextResponse.json(
          { success: false, error: "Failed to create nutrition plan" },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
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
        },
        { status: 200 }
      );
    }

    // Generate calculated nutrition plan
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
      phaseId: phaseCheck.phaseId,
      coachNotes: validationResult.data.coachNotes,
      goalSource,
    });

    if (!newPlanId) {
      return NextResponse.json(
        { success: false, error: "Failed to create nutrition plan" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
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
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error generating nutrition plan:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to generate nutrition plan" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = nutritionSettingsPatchSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    // Only include_activity_burn and unit_preference remain on clients table
    const updates: ClientUpdate = {};
    if (validationResult.data.unitPreference !== undefined) {
      updates.unit_preference = validationResult.data.unitPreference;
    }
    if (validationResult.data.includeActivityBurn !== undefined) {
      updates.include_activity_burn = validationResult.data.includeActivityBurn;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from("clients")
        .update(updates)
        .eq("id", clientId)
        .eq("coach_id", coachId);

      if (error) throw new Error("Failed to update settings");
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating nutrition settings:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to update nutrition settings" },
      { status: 500 }
    );
  }
}
