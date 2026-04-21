import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { moveEvent, moveEventAndFuture } from "@/services/training-event-calendar-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
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

    if (scope === "single") {
      await moveEvent(eventId, targetDate, clientId, planId);
    } else {
      // Shifts all future events sharing this session's training_session_id by the
      // same day offset. For events with no session link, degrades to a single move.
      await moveEventAndFuture(eventId, targetDate, clientId, planId);
    }

    // Cascade: regenerate nutrition events for affected dates
    const { data: nutritionPlans } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id, status")
      .eq("client_id", clientId)
      .in("status", ["active", "planned"]);

    for (const np of nutritionPlans ?? []) {
      const fromDate = np.status === "active" ? targetDate : undefined;
      await regenerateFutureNutritionEvents(clientId, np.id, fromDate).catch((err) =>
        captureApiError(err, { action: "cascade-nutrition-events-from-move", planId: np.id })
      );
    }

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
