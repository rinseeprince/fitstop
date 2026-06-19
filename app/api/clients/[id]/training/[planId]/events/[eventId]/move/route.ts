import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { moveEvent, moveEventAndFuture } from "@/services/training-event-calendar-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { z } from "zod";

const moveEventSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  scope: z.enum(["single", "all_future"]),
});

/**
 * POST - Move a training event to a new date.
 * scope: "single" moves just this event.
 * scope: "all_future" updates the template session and regenerates future events.
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
    const coachId = await getAuthenticatedCoachId();
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

    const { targetDate, scope } = validation.data;

    let earliestAffectedDate: string;
    if (scope === "single") {
      const result = await moveEvent(eventId, targetDate, clientId, planId);
      earliestAffectedDate = result.sourceDate < targetDate ? result.sourceDate : targetDate;
    } else {
      // Shifts all future events sharing this session's training_session_id by the
      // same day offset. For events with no session link, degrades to a single move.
      const result = await moveEventAndFuture(eventId, targetDate, clientId, planId);
      earliestAffectedDate =
        result.earliestSourceDate < targetDate ? result.earliestSourceDate : targetDate;
    }

    // Cascade: regenerate nutrition events for affected dates.
    // Use min(source, target) so a forward-in-time move also clears the stale
    // nutrition_event row on the source date.
    await cascadeNutritionAfterTrainingChange(
      clientId,
      earliestAffectedDate,
      "cascade-nutrition-events-from-move"
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
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
