import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientAdherence } from "@/services/client-adherence-service";

const DEFAULT_DAYS = 14;
const MIN_DAYS = 7;
const MAX_DAYS = 28;

// The Overview's three-rail adherence card (AdherenceSummary contract).
// ?days= is clamped to [7, 28]; the window ends client-local today.
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
