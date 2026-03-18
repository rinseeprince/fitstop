import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import type { NutritionPlanHistory } from "@/types/check-in";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await context.params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    // Read plan history from nutrition_plans table (replaces nutrition_plan_history)
    const { data: plans, error } = await supabaseAdmin
      .from("nutrition_plans")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching nutrition history:", error.message);
      return NextResponse.json(
        { success: false, error: "Failed to fetch nutrition history" },
        { status: 500 }
      );
    }

    const history: NutritionPlanHistory[] = (plans || []).map((row) => ({
      id: row.id,
      clientId: row.client_id,
      createdAt: row.created_at,
      baseWeightKg: row.base_weight_kg,
      goalWeightKg: row.goal_weight_kg ?? undefined,
      bmr: row.bmr ?? undefined,
      tdee: row.tdee ?? undefined,
      workActivityLevel: row.work_activity_level as any,
      trainingVolumeHours: row.training_volume_hours as any,
      proteinTargetGPerKg: row.protein_target_g_per_kg,
      dietType: row.diet_type as any,
      goalDeadline: row.goal_deadline ?? undefined,
      calorieTarget: row.baseline_calories,
      proteinTargetG: row.protein_target_g,
      carbTargetG: row.carb_target_g,
      fatTargetG: row.fat_target_g,
      createdByCoachId: row.coach_id,
      regenerationReason: row.regeneration_reason ?? undefined,
      // Additional fields from nutrition_plans
      status: row.status,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until ?? undefined,
      name: row.name ?? undefined,
    }));

    return NextResponse.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("Error in nutrition history route:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
