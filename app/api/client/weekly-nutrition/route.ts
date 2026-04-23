import { NextRequest, NextResponse } from "next/server";
import { requireClientAuthWithCheckInDay } from "@/lib/require-client-auth";
import { getCoachingWeekSummaryLive } from "@/services/weekly-nutrition-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuthWithCheckInDay(request);
  if (!auth.ok) return auth.response;

  try {
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
