import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientTrainingPlan } from "@/services/client-portal-service";
import { clientApiRateLimit } from "@/lib/rate-limit";

// GET /api/client/training - Get client's active training plan
export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const plan = await getClientTrainingPlan(clientId);

    return NextResponse.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error("Error fetching training plan:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch training plan",
      },
      { status: 500 }
    );
  }
}
