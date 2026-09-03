import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getWellnessSeriesPayload } from "@/services/wellness-series-service";

// The client's wellness journey (WellnessSeries contract): the five wellness
// metrics as day-values from the client's own daily log. Read by the
// Journey's Wellness pane — its own key and cache, apart from the measurement
// series the Overview chart shares, which draws no wellness point (owner
// decision D19).
//
// The whole history, not a window, like the measurement series: the pane's
// hero and chart span the journey.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const series = await getWellnessSeriesPayload(clientId);

    return NextResponse.json(
      { success: true, data: series },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error building wellness series:", error);
    return NextResponse.json(
      { error: "Failed to build wellness series" },
      { status: 500 }
    );
  }
}
