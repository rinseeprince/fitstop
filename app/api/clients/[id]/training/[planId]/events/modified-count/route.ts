import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { countModifiedFutureEvents } from "@/services/training-event-calendar-service";

/**
 * GET - Count future scheduled events that have been manually modified.
 * Used by the calendar UI to show a warning before regeneration.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const count = await countModifiedFutureEvents(clientId, planId);

    return NextResponse.json({ success: true, count }, { status: 200 });
  } catch (error) {
    console.error("Error counting modified events:", error);
    return NextResponse.json(
      { error: "Failed to count modified events" },
      { status: 500 }
    );
  }
}
