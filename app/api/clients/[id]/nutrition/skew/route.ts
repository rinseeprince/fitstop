import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { dayCalorieOverridesSchema } from "@/lib/validations/nutrition";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { DayCalorieOverrides } from "@/types/check-in";
import type { Database } from "@/types/database";
import { getDateString } from "@/lib/date-helpers";
import { getClientTodayString } from "@/services/today-service";
import { promoteNutritionPlanIfReady } from "@/services/nutrition-plan-service";
import { deleteFutureNutritionEventsForPlan, regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";

type DailyTargetInsert = Database["public"]["Tables"]["nutrition_plan_daily_targets"]["Insert"];

/**
 * POST: Save a custom day distribution as a new plan version.
 * Archives the current active plan and creates a new one with the adjusted per-day targets.
 */
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
    const parseResult = dayCalorieOverridesSchema.safeParse(body.dayCalorieOverrides);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid or missing dayCalorieOverrides" },
        { status: 400 }
      );
    }

    const dayCalorieOverrides = parseResult.data as DayCalorieOverrides;

    // Client-local today: this route stamps a new plan's effective_from
    // directly (it bypasses the atomic RPC), so it must anchor the same way.
    // Resolved once and shared with the promotion check below.
    const today = await getClientTodayString(clientId);

    // Promote planned plan if its effective date has arrived
    await promoteNutritionPlanIfReady(clientId, today);

    // Get the current active plan
    const { data: currentPlan, error: planError } = await supabaseAdmin
      .from("nutrition_plans")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (planError || !currentPlan) {
      return NextResponse.json(
        { error: "No active nutrition plan found" },
        { status: 400 }
      );
    }

    const yesterdayDate = new Date(today + "T00:00:00");
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getDateString(yesterdayDate);

    // Archive current plan (effective_until = yesterday to avoid overlap with new plan)
    await supabaseAdmin
      .from("nutrition_plans")
      .update({
        status: "archived",
        effective_until: yesterday,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentPlan.id);

    // Create new plan version (same base values, just different daily targets)
    const { data: newPlan, error: insertError } = await supabaseAdmin
      .from("nutrition_plans")
      .insert({
        client_id: clientId,
        coach_id: coachId,
        status: "active",
        effective_from: today,
        work_activity_level: currentPlan.work_activity_level,
        training_volume_hours: currentPlan.training_volume_hours,
        protein_target_g_per_kg: currentPlan.protein_target_g_per_kg,
        diet_type: currentPlan.diet_type,
        goal_weight_kg: currentPlan.goal_weight_kg,
        goal_deadline: currentPlan.goal_deadline,
        baseline_calories: currentPlan.baseline_calories,
        protein_target_g: currentPlan.protein_target_g,
        carb_target_g: currentPlan.carb_target_g,
        fat_target_g: currentPlan.fat_target_g,
        base_weight_kg: currentPlan.base_weight_kg,
        bmr: currentPlan.bmr,
        tdee: currentPlan.tdee,
        custom_macros_enabled: currentPlan.custom_macros_enabled,
        custom_calories: currentPlan.custom_calories,
        custom_protein_g: currentPlan.custom_protein_g,
        custom_carb_g: currentPlan.custom_carb_g,
        custom_fat_g: currentPlan.custom_fat_g,
        regeneration_reason: "custom_day_distribution",
      })
      .select("id")
      .single();

    if (insertError || !newPlan) {
      return NextResponse.json(
        { error: "Failed to create new plan version" },
        { status: 500 }
      );
    }

    // Fetch is_training_day from old plan's daily targets to preserve them
    const { data: oldTargets } = await supabaseAdmin
      .from("nutrition_plan_daily_targets")
      .select("day_of_week, is_training_day")
      .eq("nutrition_plan_id", currentPlan.id);

    const oldTrainingDays = new Map(
      (oldTargets || []).map((t) => [t.day_of_week, t.is_training_day])
    );

    // Insert 7 daily target rows using the override values
    const dailyTargets: DailyTargetInsert[] = DAYS_OF_WEEK.map((day) => {
      const override = dayCalorieOverrides[day];
      return {
        nutrition_plan_id: newPlan.id,
        day_of_week: day,
        calories: override?.calories ?? currentPlan.baseline_calories,
        protein_g: override?.protein_g ?? currentPlan.protein_target_g,
        carb_g: override?.carbs_g ?? currentPlan.carb_target_g,
        fat_g: override?.fat_g ?? currentPlan.fat_target_g,
        is_training_day: oldTrainingDays.get(day) ?? false,
      };
    });

    const { error: targetsError } = await supabaseAdmin
      .from("nutrition_plan_daily_targets")
      .insert(dailyTargets);

    if (targetsError) {
      console.error("Error inserting skewed daily targets:", targetsError.message);
      return NextResponse.json(
        { error: "Failed to save daily targets" },
        { status: 500 }
      );
    }

    // Non-blocking: clean up old plan events, generate for new skewed plan.
    // Both share the route's anchor date so the delete/regen pair can't split
    // across a UTC/client-local day boundary.
    await deleteFutureNutritionEventsForPlan(currentPlan.id, today).catch((err) =>
      captureApiError(err, { action: "delete-future-nutrition-events-skew", planId: currentPlan.id })
    );
    await regenerateFutureNutritionEvents(clientId, newPlan.id, today).catch((err) =>
      captureApiError(err, { action: "generate-nutrition-events-skew", planId: newPlan.id })
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error saving custom day distribution:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { error: "Failed to save custom day distribution" },
      { status: 500 }
    );
  }
}
