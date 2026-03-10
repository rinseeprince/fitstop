import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { getClientHabits } from "@/services/daily-habits-service";
import { apiRateLimit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
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

    const [trainingPlan, habits] = await Promise.all([
      getActiveTrainingPlan(clientId),
      getClientHabits(clientId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        hasTrainingPlan: trainingPlan !== null,
        hasNutritionPlan: !!client.nutritionPlanCreatedDate,
        hasHabits: habits.length > 0,
      },
    });
  } catch (error) {
    console.error("Error checking activation readiness:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check activation readiness" },
      { status: 500 }
    );
  }
}
