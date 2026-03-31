import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientWithCheckInDay } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getCoachingWeekSummaryLive } from "@/services/weekly-nutrition-service";

export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const auth = await getAuthenticatedClientWithCheckInDay();

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Always compute live from nutrition_logs using coaching week boundaries
    const summary = await getCoachingWeekSummaryLive(auth.clientId, auth.checkInDay);
    return NextResponse.json(
      { success: true, data: summary },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching weekly nutrition summary:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to fetch weekly nutrition summary" },
      { status: 500 }
    );
  }
}
