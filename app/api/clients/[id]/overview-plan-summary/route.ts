import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getOverviewPlanSummary } from "@/services/overview-plan-summary-service";

// Date-resolved training + nutrition plan metadata for the Overview's
// CURRENT PLAN cards (OverviewPlanSummary contract).
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

    const summary = await getOverviewPlanSummary(auth.coachId, clientId);

    return NextResponse.json(
      { success: true, data: summary },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error building overview plan summary:", error);
    return NextResponse.json(
      { error: "Failed to build plan summary" },
      { status: 500 }
    );
  }
}
