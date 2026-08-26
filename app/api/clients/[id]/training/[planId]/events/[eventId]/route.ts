import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { deleteEvent } from "@/services/training-event-calendar-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";

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

    // Cascade: a delete changes exactly the day the event sat on — which the
    // service now reports, so this no longer has to anchor at today and rewrite
    // the whole horizon to cover one deleted day.
    const { date: deletedDate } = await deleteEvent(eventId, clientId, planId);

    await cascadeNutritionAfterTrainingChange(
      clientId,
      { kind: "dates", dates: [deletedDate] },
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
