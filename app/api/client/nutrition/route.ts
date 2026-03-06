import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientNutritionTargets } from "@/services/client-portal-service";
import { clientApiRateLimit } from "@/lib/rate-limit";

// GET /api/client/nutrition - Get client's nutrition targets
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

    const targets = await getClientNutritionTargets(clientId);

    return NextResponse.json({
      success: true,
      data: targets,
    });
  } catch (error) {
    console.error("Error fetching nutrition targets:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch nutrition",
      },
      { status: 500 }
    );
  }
}
