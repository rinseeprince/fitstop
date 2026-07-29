import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { moveEvent } from "@/services/training-event-calendar-service";
import { DateOccupiedError } from "@/services/training-event-occupancy";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { z } from "zod";

const moveEventSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  // No `scope`: there is one kind of move. A stale tab still sending the
  // retired `scope: "all_future"` is harmless — zod strips unrecognised keys
  // rather than rejecting, so its drag still lands as a single move.
});

/**
 * POST - Move a training event to a new date. Always a single-event move: the
 * "this and all future X sessions" scope was removed because it resolved
 * siblings by `training_session_id`, and whole-program placement gives every
 * placed day its own cloned session row — so it could never find a sibling and
 * behaved identically to a single move while asking the coach a question.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; eventId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId, eventId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = moveEventSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid input", details: validation.error.issues }, { status: 400 });
    }

    const { targetDate } = validation.data;

    const result = await moveEvent(eventId, targetDate, clientId, planId);

    // Cascade: a move changes exactly two days — the one it left (now a rest day)
    // and the one it landed on. Passing both, rather than min(source, target) as a
    // floor, stops a three-day move from rewriting eight weeks of nutrition.
    await cascadeNutritionAfterTrainingChange(
      clientId,
      { kind: "dates", dates: [result.sourceDate, targetDate] },
      "cascade-nutrition-events-from-move"
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof DateOccupiedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Failed to move event";

    if (message.includes("already scheduled") || message.includes("outside the current phase")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("past date") || message.includes("Only scheduled")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Error moving event:", error);
    return NextResponse.json({ error: "Failed to move event" }, { status: 500 });
  }
}
