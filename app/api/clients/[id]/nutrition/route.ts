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

    const clientValidation = validateClientForNutrition(client);
    if (!clientValidation.valid) {
      return NextResponse.json(
        { success: false, error: "Client missing required data for nutrition calculation" },
        { status: 400 }
      );
    }

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

      const tdee = client.bmr
        ? calculateTDEE(client.bmr, body.workActivityLevel)
        : client.tdee;

      const trainingPlan = await getActiveTrainingPlan(clientId);
      await createNutritionPlan({
        clientId,
        coachId,
        workActivityLevel: body.workActivityLevel,
        trainingVolumeHours: body.trainingVolumeHours || "2-3",
        proteinTargetGPerKg: body.proteinTargetGPerKg,
        dietType: body.dietType,
        goalWeightKg: client.goalWeight
          ? weightToKg(client.goalWeight, client.weightUnit || "lbs")
          : null,
        goalDeadline: body.goalDeadline || null,
        baselineCalories: body.customCalories,
        proteinTargetG: body.customProteinG,
        carbTargetG: body.customCarbG,
        fatTargetG: body.customFatG,
        baseWeightKg: weightToKg(client.currentWeight!, client.weightUnit || "lbs"),
        bmr: client.bmr ?? null,
        tdee: tdee ?? null,
        customMacrosEnabled: true,
        customCalories: body.customCalories,
        customProteinG: body.customProteinG,
        customCarbG: body.customCarbG,
        customFatG: body.customFatG,
        regenerationReason: "custom_macros",
        trainingPlan,
      });

      return NextResponse.json(
        {
          success: true,
          plan: {
            calorieTarget: body.customCalories,
            proteinTargetG: body.customProteinG,
            carbTargetG: body.customCarbG,
            fatTargetG: body.customFatG,
            adjustedTdee: tdee ?? client.tdee!,
            weeklyWeightChangeKg: 0,
            warnings: [],
          },
        },
        { status: 200 }
      );
    }

    // Generate calculated nutrition plan
    const currentWeightKg = weightToKg(client.currentWeight!, client.weightUnit || "lbs");
    const goalWeightKg = client.goalWeight
      ? weightToKg(client.goalWeight, client.weightUnit || "lbs")
      : undefined;

    const trainingPlan = await getActiveTrainingPlan(clientId);

    const plan = generateNutritionPlan({
      currentWeightKg,
      goalWeightKg,
      bmr: client.bmr!,
      gender: client.gender as "male" | "female" | "other",
      workActivityLevel: body.workActivityLevel,
      trainingVolumeHours: body.trainingVolumeHours,
      trainingPlan,
      proteinTargetGPerKg: body.proteinTargetGPerKg,
      dietType: body.dietType,
      goalDeadline: body.goalDeadline,
      weightUnit: client.weightUnit || "lbs",
    });

    // Check if client already has an active plan (for regeneration_reason)
    const { data: existingPlan } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();

    await createNutritionPlan({
      clientId,
      coachId,
      workActivityLevel: body.workActivityLevel,
      trainingVolumeHours: body.trainingVolumeHours || "2-3",
      proteinTargetGPerKg: body.proteinTargetGPerKg,
      dietType: body.dietType,
      goalWeightKg: goalWeightKg ?? null,
      goalDeadline: body.goalDeadline || null,
      baselineCalories: plan.baselineCalories,
      proteinTargetG: plan.proteinTargetG,
      carbTargetG: plan.carbTargetG,
      fatTargetG: plan.fatTargetG,
      baseWeightKg: currentWeightKg,
      bmr: client.bmr ?? null,
      tdee: plan.tdee,
      customMacrosEnabled: false,
      customCalories: null,
      customProteinG: null,
      customCarbG: null,
      customFatG: null,
      regenerationReason: existingPlan ? "regenerated" : "initial",
      trainingPlan,
    });

    return NextResponse.json(
      {
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
