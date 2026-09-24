import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getOverviewBrief } from "@/services/client-overview-brief-service";

// The brief is computed against the stored last_viewed_at anchor, which this
// GET never moves — it moves only via POST …/overview-brief/seen, so the coach
// controls when the activity feed clears. Its one write starts the anchor on a
// first visit, only when none exists (services/client-overview-brief-service.ts).
// That write needs no CSRF check: a forged cross-site GET could only start the
// anchor early, on a client the coach owns, and never moves or clears one.
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

    const brief = await getOverviewBrief(auth.coachId, clientId);

    return NextResponse.json(
      { success: true, data: brief },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error building overview brief:", error);
    return NextResponse.json(
      { error: "Failed to build overview brief" },
      { status: 500 }
    );
  }
}
