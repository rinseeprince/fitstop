import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getOverviewBrief } from "@/services/client-overview-brief-service";

// GET returns the coach pre-session brief AND upserts last_viewed_at as a side
// effect (the brief is read relative to the prior timestamp, then the new one is
// recorded). This is a deliberate, sanctioned exception to §9's "mutations only
// for CSRF" rule: the only state change is the coach's own self-owned view
// timestamp, behind coachApiRateLimit + coach-ownership auth, with no
// cross-principal effect — so no CSRF token is required.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
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
