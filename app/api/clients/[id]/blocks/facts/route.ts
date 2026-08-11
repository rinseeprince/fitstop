import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getBlockFacts } from "@/services/client-blocks-facts-service";
import { getClientTodayString } from "@/services/today-service";

// Read-only decoration for the Journey tab's expanded block cards: which
// training programs ran during each block and what the nutrition targets were
// (from the EVENTS + the era's version, per Session 1B). Kept off the chain
// GET deliberately — PUT/DELETE echo that GET's exact payload ("one shape, no
// drift", Session 2), and folding four extra reads into every write echo
// would break that for a column only this pane renders.

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

    const clientToday = await getClientTodayString(clientId);
    const facts = await getBlockFacts(clientId, clientToday);

    return NextResponse.json(
      { success: true, data: { facts } },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching block facts:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch block facts" },
      { status: 500 }
    );
  }
}
