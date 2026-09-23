import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalHistory } from "@/services/client-goals-service";

/**
 * The Journey's goals table: every goal, planned first, each with its last
 * day, whether it is planned, current or ended, and its deadline changes, the
 * nutrition versions and the programs during it.
 */
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

    const history = await getGoalHistory(clientId);

    return NextResponse.json(
      { success: true, data: history },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching goal history:", error);
    return NextResponse.json(
      { error: "Failed to fetch goal history" },
      { status: 500 }
    );
  }
}
