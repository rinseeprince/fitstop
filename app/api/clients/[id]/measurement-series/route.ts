import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getMeasurementSeriesPayload } from "@/services/measurement-series-service";

// The client's measurement journey (MeasurementSeries contract): every
// metric's day-values from the measurement log, the derived baseline per
// metric and the start date. Read by the Overview progression chart and the
// Journey's Physique pane alike — one key, one cache.
//
// The whole history, not a window: the browser holds the start date and does
// the split itself, because the Journey lists readings dated before the start
// under "Before start" while its chart and maths begin at the start.
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

    const series = await getMeasurementSeriesPayload(clientId);

    return NextResponse.json(
      { success: true, data: series },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error building measurement series:", error);
    return NextResponse.json(
      { error: "Failed to build measurement series" },
      { status: 500 }
    );
  }
}
