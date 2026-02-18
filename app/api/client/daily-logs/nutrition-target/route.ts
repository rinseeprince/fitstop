import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { 
  getTodaysNutritionTarget, 
  getTodaysTrainingSession, 
  getTodaysPlannedActivities 
} from "@/services/daily-logs-service";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const [nutritionTarget, trainingSession, plannedActivities] = await Promise.all([
      getTodaysNutritionTarget(clientId),
      getTodaysTrainingSession(clientId),
      getTodaysPlannedActivities(clientId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        nutritionTarget,
        trainingSession,
        plannedActivities,
      },
    });
  } catch (error) {
    console.error("Error fetching nutrition target and context:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch nutrition target",
      },
      { status: 500 }
    );
  }
}