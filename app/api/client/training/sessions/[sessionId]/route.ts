import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import {
  getSessionWithExercises,
  getActiveTrainingPlanId,
} from "@/services/training-service";

/**
 * GET a training session + its active exercises, scoped to the client's ACTIVE
 * plan (Session 5.3). Powers the rest-day picker → tracker flow in 5.4: after
 * the client picks a session, the tracker fetches it here to populate detailed
 * mode. A session from another client, or from an archived/draft plan, collapses
 * to 404 (no existence leak — §8 IDOR convention).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { sessionId } = await params;

  try {
    const [session, activePlanId] = await Promise.all([
      getSessionWithExercises(sessionId),
      getActiveTrainingPlanId(auth.clientId),
    ]);

    if (!session || !activePlanId || session.planId !== activePlanId) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { success: true, data: { session } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error fetching training session:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch session" },
      { status: 500 },
    );
  }
}
