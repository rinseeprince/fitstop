import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import type { NutritionPlanHistory } from "@/types/check-in";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await context.params;

    // Fetch nutrition plan history for this client, ordered by creation date (newest first)
    const { data: historyData, error: historyError } = await supabaseAdmin
      .from("nutrition_plan_history")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (historyError) {
      console.error("Error fetching nutrition history:", historyError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch nutrition history" },
        { status: 500 }
      );
    }

    // Map database rows to NutritionPlanHistory type
    const history: NutritionPlanHistory[] = (historyData || []).map((row: any) => ({
      id: row.id,
      clientId: row.client_id,
      createdAt: row.created_at,
      baseWeightKg: row.base_weight_kg,
      goalWeightKg: row.goal_weight_kg,
      bmr: row.bmr,
      tdee: row.tdee,
      workActivityLevel: row.work_activity_level,
      trainingVolumeHours: row.training_volume_hours,
      proteinTargetGPerKg: row.protein_target_g_per_kg,
      dietType: row.diet_type,
      goalDeadline: row.goal_deadline,
      calorieTarget: row.calorie_target,
      proteinTargetG: row.protein_target_g,
      carbTargetG: row.carb_target_g,
      fatTargetG: row.fat_target_g,
      createdByCoachId: row.created_by_coach_id,
      regenerationReason: row.regeneration_reason,
    }));

    return NextResponse.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("Error in nutrition history route:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
