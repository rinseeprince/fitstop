import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientProgressData } from "@/services/client-portal-service";
import { apiRateLimit } from "@/lib/rate-limit";

// GET /api/client/progress - Get client's progress data for charts
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

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "90", 10);

    const progressData = await getClientProgressData(clientId, days);

    return NextResponse.json({
      success: true,
      data: progressData,
    });
  } catch (error) {
    console.error("Error fetching progress data:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch progress",
      },
      { status: 500 }
    );
  }
}
