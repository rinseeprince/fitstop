import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientAdherence } from "@/services/client-adherence-service";

const DEFAULT_DAYS = 14;
const MIN_DAYS = 7;
// The ceiling is load-bearing, not arbitrary: getClientAdherence runs five
// UNPAGED selects, and daily_habit_logs scales as habits x days — at "all time"
// it would eventually truncate at PostgREST's row cap, and a truncated rail
// reads as a client who stopped logging rather than as missing data. Raise this
// only alongside paging that read.
//
// It sits well above the Overview's own 14-day rails deliberately: it was
// raised from 28 for a selectable 60-day window that has since been removed,
// and a ceiling nothing is pressing against costs nothing to leave where it is.
const MAX_DAYS = 60;

// The Overview's three adherence rails (AdherenceSummary contract).
// ?days= is clamped to [7, 60]; the window ends client-local today.
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

    const daysParam = request.nextUrl.searchParams.get("days");
    let days = DEFAULT_DAYS;
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

    const summary = await getClientAdherence(clientId, days);

    return NextResponse.json(
      { success: true, data: summary },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error building adherence summary:", error);
    return NextResponse.json(
      { error: "Failed to build adherence summary" },
      { status: 500 }
    );
  }
}
