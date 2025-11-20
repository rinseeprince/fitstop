import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
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
        !body.customFatG
      ) {
        return NextResponse.json(
          {
            error: "Custom macros enabled but values not provided",
          },
          { status: 400 }
        );
      }

      // Calculate total calories from custom macros
      const customCalories =
        body.customProteinG * 4 + body.customCarbG * 4 + body.customFatG * 9;

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
            calorie_target: Math.round(customCalories),
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
        calorie_target: Math.round(customCalories),
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
            calorieTarget: Math.round(customCalories),
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

    const plan = generateNutritionPlan({
      currentWeightKg,
      goalWeightKg,
      bmr: client.bmr!,
      tdee: client.tdee!,
      gender: client.gender as "male" | "female" | "other",
      workActivityLevel: body.workActivityLevel,
      trainingVolumeHours: body.trainingVolumeHours,
      proteinTargetGPerKg: body.proteinTargetGPerKg,
      dietType: body.dietType,
      goalDeadline: body.goalDeadline,
      weightUnit: client.weightUnit || "lbs",
    });

    // Update client with calculated plan
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
          calorie_target: plan.calorieTarget,
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
          calorieTarget: plan.calorieTarget,
          proteinTargetG: plan.proteinTargetG,
          carbTargetG: plan.carbTargetG,
          fatTargetG: plan.fatTargetG,
          adjustedTdee: plan.adjustedTdee,
          weeklyWeightChangeKg: plan.weeklyWeightChangeKg,
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
