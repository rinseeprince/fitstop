import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { getClientHabits } from "@/services/daily-habits-service";
import { getActiveRoadmap } from "@/services/roadmap-service";
import { getActivePhase } from "@/services/phase-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { promoteNutritionPlanIfReady } from "@/services/nutrition-plan-service";

async function safeQuery<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error("Activation readiness query failed:", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

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
    const client = await getClientById(clientId, true);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    // Promote planned plan if its effective date has arrived
    await promoteNutritionPlanIfReady(clientId);

    const [trainingPlan, habits, nutritionPlan, roadmap, activePhase] = await Promise.all([
      safeQuery(() => getActiveTrainingPlan(clientId)),
      safeQuery(() => getClientHabits(clientId)),
      safeQuery(async () => {
        const { data } = await supabaseAdmin
          .from("nutrition_plans")
          .select("id")
          .eq("client_id", clientId)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        return data;
      }),
      safeQuery(() => getActiveRoadmap(clientId)),
      safeQuery(() => getActivePhase(clientId)),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        hasTrainingPlan: trainingPlan !== null,
        hasNutritionPlan: nutritionPlan !== null,
        hasHabits: Array.isArray(habits) && habits.length > 0,
        hasRoadmap: roadmap !== null,
        hasActivePhase: activePhase !== null,
        activePhaseName: activePhase?.name ?? null,
        activePhaseStartDate: activePhase?.startDate ?? null,
        roadmapRecommended: true,
      },
    });
  } catch (error) {
    console.error("Error checking activation readiness:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to check activation readiness" },
      { status: 500 }
    );
  }
}
