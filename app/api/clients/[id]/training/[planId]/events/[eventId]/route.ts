import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { deleteEvent, updateEventSurplus } from "@/services/training-event-calendar-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { getClientTodayString } from "@/services/today-service";
import { z } from "zod";

const patchEventSchema = z.object({
  calorieSurplusPercentage: z.number().min(0).max(100).nullable(),
});

/**
 * PATCH - Update a single event's field(s). Currently only supports surplus %
 * for the "Just this day" scope when editing a shared session's calorie
 * surplus — changes only this one event, preserving the shared session's
 * defaults for other dates.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; eventId: string }> },
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
    const validation = patchEventSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 },
      );
    }

    // Ownership is enforced inside the UPDATE (scoped to clientId); a foreign
    // eventId matches zero rows and throws "Event not found" before any write.
    const { date } = await updateEventSurplus(
      eventId,
      validation.data.calorieSurplusPercentage,
      clientId,
    );

    await cascadeNutritionAfterTrainingChange(
      clientId,
      date,
      "cascade-nutrition-from-event-surplus-edit",
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update event";
    if (message.includes("Event not found")) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    console.error("Error updating event:", error);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

// DELETE - Delete a single scheduled training event
export async function DELETE(
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

    await deleteEvent(eventId, clientId, planId);

    // Cascade: a delete affects today-forward, so anchor at client-local today.
    const today = await getClientTodayString(clientId);
    await cascadeNutritionAfterTrainingChange(
      clientId,
      today,
      "cascade-nutrition-events-from-delete"
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete event";

    if (message.includes("Only scheduled") || message.includes("Cannot delete past")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("does not belong")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("Error deleting event:", error);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
