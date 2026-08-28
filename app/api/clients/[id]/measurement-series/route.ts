import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getMeasurementSeries } from "@/services/measurement-series-service";
import { DEFAULT_OVERVIEW_WINDOW, OVERVIEW_WINDOWS } from "@/lib/overview/window";

// The Overview progression chart's weight / body-fat series, bounded to the
// selected window (MeasurementSeries contract).
//
// The bounds ARE the Overview's window options rather than a wider range of
// their own: this route exists because the unbounded alternative (paging the
// client's whole check-in history for two columns) is what it replaces, and a
// ceiling nothing asks for is a ceiling nobody maintains.
const MIN_DAYS = Math.min(...OVERVIEW_WINDOWS);
const MAX_DAYS = Math.max(...OVERVIEW_WINDOWS);

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

    // Param handling mirrors the adherence route exactly, so the two reads
    // behind one window control cannot answer a malformed `days` differently.
    const daysParam = request.nextUrl.searchParams.get("days");
    let days: number = DEFAULT_OVERVIEW_WINDOW;
    if (daysParam !== null) {
      const parsed = Number(daysParam);
      if (!Number.isInteger(parsed)) {
        return NextResponse.json(
          { success: false, error: "days must be an integer" },
          { status: 400 }
        );
      }
      days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, parsed));
    }

    const series = await getMeasurementSeries(clientId, days);

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
