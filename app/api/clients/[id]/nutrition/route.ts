import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { generateNutritionPlan, calculateTDEE } from "@/services/nutrition-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import {
  nutritionPlanSchema,
  validateClientForNutrition,
} from "@/lib/validations/nutrition";
import { weightToKg } from "@/utils/nutrition-helpers";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    // Check authentication
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    // Get client
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Verify the client belongs to the authenticated coach
    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body: GenerateNutritionPlanRequest = await request.json();
    const validationResult = nutritionPlanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    // Validate client has required data
    const clientValidation = validateClientForNutrition(client);
    if (!clientValidation.valid) {
      return NextResponse.json(
        {
          error: "Client missing required data for nutrition calculation",
          details: clientValidation.errors,
        },
        { status: 400 }
      );
    }

    // Handle custom macros
    if (body.customMacrosEnabled) {
      if (
        !body.customProteinG ||
        !body.customCarbG ||
        !body.customFatG ||
        !body.customCalories
      ) {
        return NextResponse.json(
          {
            error: "Custom macros enabled but values not provided",
          },
          { status: 400 }
        );
      }

      // Validate custom calories match macro totals (±50 cal tolerance)
      const calculatedCalories =
        body.customProteinG * 4 + body.customCarbG * 4 + body.customFatG * 9;
      const difference = Math.abs(body.customCalories - calculatedCalories);

      if (difference > 50) {
        return NextResponse.json(
          {
            error: `Custom calories must be within ±50 calories of macro totals (calculated: ${calculatedCalories} cal)`,
          },
          { status: 400 }
        );
      }

      // Calculate TDEE when custom macros are set (needed for display)
      const tdee = client.bmr
        ? calculateTDEE(client.bmr, body.workActivityLevel)
        : client.tdee;

      // Update client with custom values
      const { error: updateError } = await supabaseAdmin
        .from("clients")
        .update(
          // @ts-expect-error - Database type inference issue
          {
            work_activity_level: body.workActivityLevel,
            training_volume_hours: body.trainingVolumeHours,
            protein_target_g_per_kg: body.proteinTargetGPerKg,
            diet_type: body.dietType,
            goal_deadline: body.goalDeadline || null,
            custom_macros_enabled: true,
            custom_protein_g: body.customProteinG,
            custom_carb_g: body.customCarbG,
            custom_fat_g: body.customFatG,
            custom_calories: body.customCalories,
            tdee: tdee, // Set TDEE when nutrition settings are configured
            baseline_calories: body.customCalories, // Custom calories = baseline
            calorie_target: body.customCalories,
            protein_target_g: body.customProteinG,
            carb_target_g: body.customCarbG,
            fat_target_g: body.customFatG,
            nutrition_plan_created_date: new Date().toISOString(),
            nutrition_plan_base_weight_kg: weightToKg(
              client.currentWeight!,
              client.weightUnit || "lbs"
            ),
          }
        )
        .eq("id", clientId);

      if (updateError) throw updateError;

      // Save to history
      const customHistoryData = {
        client_id: clientId,
        base_weight_kg: weightToKg(
          client.currentWeight!,
          client.weightUnit || "lbs"
        ),
        goal_weight_kg: client.goalWeight
          ? weightToKg(client.goalWeight, client.weightUnit || "lbs")
          : null,
        bmr: client.bmr,
        tdee: client.tdee,
        work_activity_level: body.workActivityLevel,
        training_volume_hours: body.trainingVolumeHours,
        protein_target_g_per_kg: body.proteinTargetGPerKg,
        diet_type: body.dietType,
        goal_deadline: body.goalDeadline || null,
        calorie_target: body.customCalories,
        protein_target_g: body.customProteinG,
        carb_target_g: body.customCarbG,
        fat_target_g: body.customFatG,
        created_by_coach_id: coachId,
        regeneration_reason: "custom_macros",
      };

      const { error: historyError } = await (supabaseAdmin as any)
        .from("nutrition_plan_history")
        .insert(customHistoryData);

      if (historyError) {
        console.error("Error saving custom macros nutrition plan history:", historyError);
      }

      return NextResponse.json(
        {
          success: true,
          plan: {
            calorieTarget: body.customCalories,
            proteinTargetG: body.customProteinG,
            carbTargetG: body.customCarbG,
            fatTargetG: body.customFatG,
            adjustedTdee: client.tdee!,
            weeklyWeightChangeKg: 0,
            warnings: [],
          },
        },
        { status: 200 }
      );
    }

    // Generate calculated nutrition plan
    const currentWeightKg = weightToKg(
      client.currentWeight!,
      client.weightUnit || "lbs"
    );
    const goalWeightKg = client.goalWeight
      ? weightToKg(client.goalWeight, client.weightUnit || "lbs")
      : undefined;

    // Fetch active training plan for per-day training calories
    const trainingPlan = await getActiveTrainingPlan(clientId);

    const plan = generateNutritionPlan({
      currentWeightKg,
      goalWeightKg,
      bmr: client.bmr!,
      gender: client.gender as "male" | "female" | "other",
      workActivityLevel: body.workActivityLevel,
      trainingVolumeHours: body.trainingVolumeHours, // Kept for backward compat
      trainingPlan, // Used for per-day calorie additions in weekly targets
      proteinTargetGPerKg: body.proteinTargetGPerKg,
      dietType: body.dietType,
      goalDeadline: body.goalDeadline,
      weightUnit: client.weightUnit || "lbs",
    });

    // Update client with calculated plan
    // TDEE is now calculated and saved when nutrition settings are configured
    const { error: updateError } = await supabaseAdmin
      .from("clients")
      .update(
        // @ts-expect-error - Database type inference issue
        {
          work_activity_level: body.workActivityLevel,
          training_volume_hours: body.trainingVolumeHours,
          protein_target_g_per_kg: body.proteinTargetGPerKg,
          diet_type: body.dietType,
          goal_deadline: body.goalDeadline || null,
          custom_macros_enabled: false,
          tdee: plan.tdee, // Save calculated TDEE (BMR x activity multiplier)
          baseline_calories: plan.baselineCalories, // Save baseline (TDEE - deficit)
          calorie_target: plan.calorieTarget, // Backward compat (same as baseline)
          protein_target_g: plan.proteinTargetG,
          carb_target_g: plan.carbTargetG,
          fat_target_g: plan.fatTargetG,
          nutrition_plan_created_date: new Date().toISOString(),
          nutrition_plan_base_weight_kg: currentWeightKg,
        }
      )
      .eq("id", clientId);

    if (updateError) throw updateError;

    // Save to history
    const historyData = {
      client_id: clientId,
      base_weight_kg: currentWeightKg,
      goal_weight_kg: goalWeightKg || null,
      bmr: client.bmr,
      tdee: client.tdee,
      work_activity_level: body.workActivityLevel,
      training_volume_hours: body.trainingVolumeHours,
      protein_target_g_per_kg: body.proteinTargetGPerKg,
      diet_type: body.dietType,
      goal_deadline: body.goalDeadline || null,
      calorie_target: plan.calorieTarget,
      protein_target_g: plan.proteinTargetG,
      carb_target_g: plan.carbTargetG,
      fat_target_g: plan.fatTargetG,
      created_by_coach_id: coachId,
      regeneration_reason: client.nutritionPlanCreatedDate
        ? "regenerated"
        : "initial",
    };

    const { error: historyError } = await (supabaseAdmin as any)
      .from("nutrition_plan_history")
      .insert(historyData);

    if (historyError) {
      console.error("Error saving nutrition plan history:", historyError);
    }

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
    console.error("Error generating nutrition plan:", error);
    return NextResponse.json(
      { error: "Failed to generate nutrition plan" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    // Check authentication
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    // Get client
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Verify the client belongs to the authenticated coach
    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Update unit preference if provided
    if (body.unitPreference) {
      const { error } = await supabaseAdmin
        .from("clients")
        .update(
          // @ts-expect-error - Database type inference issue
          { unit_preference: body.unitPreference }
        )
        .eq("id", clientId);

      if (error) throw error;

      return NextResponse.json({ success: true }, { status: 200 });
    }

    return NextResponse.json(
      { error: "No valid updates provided" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating nutrition settings:", error);
    return NextResponse.json(
      { error: "Failed to update nutrition settings" },
      { status: 500 }
    );
  }
}
