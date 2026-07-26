import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getOverviewBrief } from "@/services/client-overview-brief-service";

// Read-only: the brief is computed against the stored last_viewed_at anchor.
// The anchor moves only via POST …/overview-brief/seen — the old GET-side
// upsert (the sanctioned §9 exception) was removed in the Overview redesign so
// the coach controls when the activity feed clears.
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
