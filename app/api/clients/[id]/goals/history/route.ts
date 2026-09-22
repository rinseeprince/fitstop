import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getPastGoals } from "@/services/client-goals-service";

/**
 * The client's past goals, newest first and bounded: each goal that ended
 * before today's began, with its last day and the deadline it ended with.
 * Today's goal and the planned ones come from the sibling `GET …/goals`.
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

    const history = await getPastGoals(clientId);

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
