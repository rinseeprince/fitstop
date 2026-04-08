import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  nutritionPlanSchema,
  nutritionSettingsPatchSchema,
} from "@/lib/validations/nutrition";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import type { ClientUpdate } from "@/lib/database-helpers";
import type { DietType, GenerateNutritionPlanRequest } from "@/types/check-in";
import {
  orchestrateNutritionPlanCreation,
  NutritionPlanError,
} from "@/services/nutrition-plan-orchestrator";
import { promoteNutritionPlanIfReady } from "@/services/nutrition-plan-service";

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

    // Promote planned plan if its effective date has arrived
    await promoteNutritionPlanIfReady(clientId);

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

    // Check for a planned (upcoming) plan
    const { data: plannedPlan } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id, effective_from, baseline_calories, protein_target_g, carb_target_g, fat_target_g, custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g, diet_type")
      .eq("client_id", clientId)
      .eq("status", "planned")
      .maybeSingle();

    let upcomingPlan: {
      effectiveFrom: string;
      calorieTarget: number;
      proteinTargetG: number;
      carbTargetG: number;
      fatTargetG: number;
      dietType: string;
      dailyTargets: typeof dailyTargets;
    } | null = null;

    if (plannedPlan) {
      const { data: plannedDailyTargetRows } = await supabaseAdmin
        .from("nutrition_plan_daily_targets")
        .select("*")
        .eq("nutrition_plan_id", plannedPlan.id);

      const plannedDietType = (plannedPlan.diet_type as DietType) || "balanced";
      const plannedDailyTargets = buildDailyTargetsFromPlan(
        plannedPlan,
        plannedDailyTargetRows,
        trainingPlan,
        includeActivityBurn,
        plannedDietType
      );

      upcomingPlan = {
        effectiveFrom: plannedPlan.effective_from,
        calorieTarget: plannedPlan.custom_macros_enabled && plannedPlan.custom_calories
          ? plannedPlan.custom_calories
          : plannedPlan.baseline_calories,
        proteinTargetG: plannedPlan.protein_target_g,
        carbTargetG: plannedPlan.carb_target_g,
        fatTargetG: plannedPlan.fat_target_g,
        dietType: plannedPlan.diet_type,
        dailyTargets: plannedDailyTargets,
      };
    }

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
      effectiveFrom: plan.effective_from,
      dailyTargets,
      upcomingPlan,
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
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    const body: GenerateNutritionPlanRequest = await request.json();
    const validationResult = nutritionPlanSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({ success: false, error: "Invalid input" }, { status: 400 });
    }

    const result = await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      body,
      { phaseId: validationResult.data.phaseId, coachNotes: validationResult.data.coachNotes }
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof NutritionPlanError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.statusCode });
    }
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
  const rateLimitResult = await coachApiRateLimit(request);
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
