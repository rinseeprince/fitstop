import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getPhaseWeeklyData } from "@/services/phase-weekly-data-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const weeklyData = await getPhaseWeeklyData(phaseId, clientId);

    return NextResponse.json(
      { success: true, data: weeklyData },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching phase weekly data:", error);
    return NextResponse.json(
      { error: "Failed to fetch weekly data" },
      { status: 500 }
    );
  }
}
