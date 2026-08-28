import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { validateDateParameter } from "@/lib/validation-helpers";
import { getMeasurementSeries } from "@/services/measurement-series-service";

// The Overview progression chart's weight / body-fat series (MeasurementSeries
// contract) — the client's whole journey, not a window.
//
// `from` is the client's start date, supplied by the browser because it already
// holds the client record; sending it saves this route a round trip it would
// otherwise make for a fact its caller already has. It only ever NARROWS a read
// the coach is already authorized for, so a forged value costs nothing beyond a
// wrong-looking chart — but it still reaches a PostgREST filter, so it is
// validated to YYYY-MM-DD rather than passed through. (`daily-logs` and
// `habits/logs` take the same shape of param and do not validate it; that is a
// gap to close there, not a pattern to copy.)
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

    const from = request.nextUrl.searchParams.get("from");
    const invalidFrom = validateDateParameter(from);
    if (invalidFrom) return invalidFrom;

    const series = await getMeasurementSeries(clientId, from ?? undefined);

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
