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
import { weightToKg, calculateDailyMacros, DAYS_OF_WEEK, getTrainingDays, getExternalActivitiesForDay, calculateExternalActivityCalories, getExternalActivitiesSummary } from "@/utils/nutrition-helpers";
import { getTrainingSessionCaloriesByDay, getTrainingSessionsSummary } from "@/utils/training-calorie-helpers";
import type { ClientUpdate } from "@/lib/database-helpers";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import type { GenerateNutritionPlanRequest, DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import type { Database } from "@/types/database";
import { upsertWeeklySummary } from "@/services/weekly-nutrition-service";
import { getWeekStart, getTodayDateString } from "@/lib/date-helpers";

type NutritionPlanInsert = Database["public"]["Tables"]["nutrition_plans"]["Insert"];
type DailyTargetInsert = Database["public"]["Tables"]["nutrition_plan_daily_targets"]["Insert"];

/**
 * Create a new nutrition plan: archive any current active plan, insert a new
 * active plan with 7 daily target rows. Returns the new plan ID or null on error.
 */
async function createNutritionPlan(params: {
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
}): Promise<string | null> {
  const today = new Date().toISOString().split("T")[0];
  const yesterdayDate = new Date(today + "T00:00:00");
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split("T")[0];

  // 1. Archive current active plan (if any)
  // Set effective_until to yesterday to avoid date overlap with the new plan
  await supabaseAdmin
    .from("nutrition_plans")
    .update({
      status: "archived",
      effective_until: yesterday,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", params.clientId)
    .eq("status", "active");

  // 2. Insert new active plan
  const planInsert: NutritionPlanInsert = {
    client_id: params.clientId,
    coach_id: params.coachId,
    status: "active",
    effective_from: today,
    work_activity_level: params.workActivityLevel,
    training_volume_hours: params.trainingVolumeHours,
    protein_target_g_per_kg: params.proteinTargetGPerKg,
    diet_type: params.dietType,
    goal_weight_kg: params.goalWeightKg,
    goal_deadline: params.goalDeadline,
    baseline_calories: params.baselineCalories,
    protein_target_g: params.proteinTargetG,
    carb_target_g: params.carbTargetG,
    fat_target_g: params.fatTargetG,
    base_weight_kg: params.baseWeightKg,
    bmr: params.bmr,
    tdee: params.tdee,
    custom_macros_enabled: params.customMacrosEnabled,
    custom_calories: params.customCalories,
    custom_protein_g: params.customProteinG,
    custom_carb_g: params.customCarbG,
    custom_fat_g: params.customFatG,
    regeneration_reason: params.regenerationReason,
  };

  const { data: newPlan, error: insertError } = await supabaseAdmin
    .from("nutrition_plans")
    .insert(planInsert)
    .select("id")
    .single();

  if (insertError || !newPlan) {
    console.error("Error inserting nutrition plan:", insertError?.message);
    return null;
  }

  // Denormalize TDEE to client profile for overview display
  if (params.tdee != null) {
    await supabaseAdmin
      .from("clients")
      .update({ tdee: params.tdee })
      .eq("id", params.clientId);
  }

  // 3. Compute and insert 7 daily target rows
  const dailyTargets: DailyTargetInsert[] = [];

  if (params.customMacrosEnabled && params.customCalories != null) {
    for (const day of DAYS_OF_WEEK) {
      dailyTargets.push({
        nutrition_plan_id: newPlan.id,
        day_of_week: day,
        calories: params.customCalories,
        protein_g: params.customProteinG ?? params.proteinTargetG,
        carb_g: params.customCarbG ?? params.carbTargetG,
        fat_g: params.customFatG ?? params.fatTargetG,
        is_training_day: false,
      });
    }
  } else {
    const trainingDays = getTrainingDays(params.trainingPlan);

    for (const day of DAYS_OF_WEEK) {
      const baselineMacros = calculateDailyMacros(
        params.baselineCalories,
        params.proteinTargetG,
        trainingDays.has(day),
        params.dietType
      );

      dailyTargets.push({
        nutrition_plan_id: newPlan.id,
        day_of_week: day,
        calories: params.baselineCalories,
        protein_g: baselineMacros.proteinG,
        carb_g: baselineMacros.carbsG,
        fat_g: baselineMacros.fatG,
        is_training_day: trainingDays.has(day),
      });
    }
  }

  const { error: targetsError } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .insert(dailyTargets);

  if (targetsError) {
    console.error("Error inserting daily targets:", targetsError.message);
  }

  // Recalculate current week's summary with new plan targets (fire-and-forget)
  upsertWeeklySummary(params.clientId, getWeekStart(getTodayDateString())).catch((err) =>
    console.error("Weekly summary recalculation failed:", err instanceof Error ? err.message : "Unknown error")
  );

  return newPlan.id;
}

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
    const trainingSessionCaloriesByDay = getTrainingSessionCaloriesByDay(trainingPlan);

    const targetsByDay = new Map(
      (dailyTargetRows || []).map((dt) => [dt.day_of_week, dt])
    );

    let dailyTargets = DAYS_OF_WEEK.map((day) => {
      const stored = targetsByDay.get(day);
      const baselineCalories = stored?.calories ?? plan.baseline_calories;
      const proteinG = stored?.protein_g ?? plan.protein_target_g;
      const carbG = stored?.carb_g ?? plan.carb_target_g;
      const fatG = stored?.fat_g ?? plan.fat_target_g;
      const isTrainingDay = stored?.is_training_day ?? false;

      const trainingSessionCalories = trainingSessionCaloriesByDay[day] || 0;
      const trainingSessions = getTrainingSessionsSummary(trainingPlan, day);
      const dayActivities = getExternalActivitiesForDay(trainingPlan, day);
      const externalActivityCalories = calculateExternalActivityCalories(dayActivities);
      const externalActivities = getExternalActivitiesSummary(dayActivities);

      const totalActivityCalories = trainingSessionCalories + externalActivityCalories;
      const dayCalories = baselineCalories + totalActivityCalories;

      const totalCal = proteinG * 4 + carbG * 4 + fatG * 9;
      const proteinPercent = totalCal > 0 ? Math.round((proteinG * 4 / totalCal) * 100) : 0;
      const carbsPercent = totalCal > 0 ? Math.round((carbG * 4 / totalCal) * 100) : 0;

      return {
        day,
        dayLabel: day.charAt(0).toUpperCase() + day.slice(1),
        isTrainingDay,
        calories: dayCalories,
        baselineCalories,
        proteinG,
        carbsG: carbG,
        fatG,
        proteinPercent,
        carbsPercent,
        fatPercent: 100 - proteinPercent - carbsPercent,
        trainingSessionCalories,
        trainingSessions,
        externalActivityCalories,
        externalActivities,
        totalCaloriesWithActivities: dayCalories,
        includeActivityBurn,
      };
    });

    // When activity burn is excluded, flatten to baseline
    if (!includeActivityBurn) {
      const dietType = (plan.diet_type as DietType) || "balanced";
      dailyTargets = dailyTargets.map((day) => {
        const macros = calculateDailyMacros(day.baselineCalories, day.proteinG, false, dietType);
        const totalCal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
        const proteinPercent = totalCal > 0 ? Math.round((macros.proteinG * 4 / totalCal) * 100) : 0;
        const carbsPercent = totalCal > 0 ? Math.round((macros.carbsG * 4 / totalCal) * 100) : 0;
        return {
          ...day,
          calories: day.baselineCalories,
          trainingSessionCalories: 0,
          externalActivityCalories: 0,
          totalCaloriesWithActivities: day.baselineCalories,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
          proteinPercent,
          carbsPercent,
          fatPercent: 100 - proteinPercent - carbsPercent,
        };
      });
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body: GenerateNutritionPlanRequest = await request.json();
    const validationResult = nutritionPlanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const clientValidation = validateClientForNutrition(client);
    if (!clientValidation.valid) {
      return NextResponse.json(
        { error: "Client missing required data for nutrition calculation" },
        { status: 400 }
      );
    }

    // Handle custom macros
    if (body.customMacrosEnabled) {
      if (!body.customProteinG || !body.customCarbG || !body.customFatG || !body.customCalories) {
        return NextResponse.json(
          { error: "Custom macros enabled but values not provided" },
          { status: 400 }
        );
      }

      const calculatedCalories =
        body.customProteinG * 4 + body.customCarbG * 4 + body.customFatG * 9;
      const difference = Math.abs(body.customCalories - calculatedCalories);

      if (difference > CUSTOM_MACRO_CALORIE_TOLERANCE) {
        return NextResponse.json(
          { error: `Custom calories must be within ±50 calories of macro totals (calculated: ${calculatedCalories} cal)` },
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
      { error: "Failed to generate nutrition plan" },
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = nutritionSettingsPatchSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input" },
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

      if (error) throw error;
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating nutrition settings:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { error: "Failed to update nutrition settings" },
      { status: 500 }
    );
  }
}
