import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { duplicateEvent } from "@/services/training-event-calendar-service";
import { DateOccupiedError } from "@/services/training-event-occupancy";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { z } from "zod";

const duplicateEventSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
});

/**
 * POST - Duplicate a training event to a new date.
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
    const validation = duplicateEventSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid input", details: validation.error.issues }, { status: 400 });
    }

    const { targetDate } = validation.data;
    const newEventId = await duplicateEvent(eventId, targetDate, clientId, planId);

    // Cascade: regenerate nutrition events for the target date
    await cascadeNutritionAfterTrainingChange(
      clientId,
      targetDate,
      "cascade-nutrition-events-from-duplicate"
    );

    return NextResponse.json({ success: true, eventId: newEventId }, { status: 200 });
  } catch (error) {
    if (error instanceof DateOccupiedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Failed to duplicate event";

    if (message.includes("already scheduled") || message.includes("outside the current phase")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("past date")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Error duplicating event:", error);
    return NextResponse.json({ error: "Failed to duplicate event" }, { status: 500 });
  }
}
