import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { placePlanOnCalendar, placeSessionOnCalendar } from "@/services/library-placement-service";
import { getClientTodayString } from "@/services/today-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";
import { z } from "zod";

const placeFromLibrarySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("plan"),
    savedPlanId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
    repeatCycles: z.number().int().min(1).max(52).optional(),
    phaseId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("session"),
    savedSessionId: z.string().uuid(),
    planId: z.string().uuid(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  }),
]);

/**
 * POST - Place a saved plan or session from the coach library onto a client's calendar.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json();
    const validation = placeFromLibrarySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;

    if (data.type === "plan") {
      // Judge "past" against the client's local today (same anchor as the
      // placement RPC's p_today), not the coach's device or server UTC.
      const clientToday = await getClientTodayString(clientId);
      if (data.startDate < clientToday) {
        return NextResponse.json(
          {
            error: `Start date ${data.startDate} has already passed for this client (their local date is ${clientToday}).`,
          },
          { status: 400 }
        );
      }

      const result = await placePlanOnCalendar({
        savedPlanId: data.savedPlanId,
        coachId,
        clientId,
        startDate: data.startDate,
        repeatCycles: data.repeatCycles,
        phaseId: data.phaseId,
      });

      // Nutrition cascade
      await cascadeNutritionEvents(clientId, data.startDate);

      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.TRAINING_PLAN_PLACE,
        targetTable: "training_plans",
        targetId: result.planId,
        clientId,
        metadata: { savedPlanId: data.savedPlanId, startDate: data.startDate },
        request,
      });

      return NextResponse.json(
        {
          success: true,
          planId: result.planId,
          sessionsCreated: result.sessionsCreated,
          eventsCreated: result.eventsCreated,
        },
        { status: 200 }
      );
    }

    // type === "session"
    const plan = await getTrainingPlanById(data.planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const result = await placeSessionOnCalendar({
      savedSessionId: data.savedSessionId,
      coachId,
      clientId,
      planId: data.planId,
      targetDate: data.targetDate,
    });

    // Nutrition cascade
    await cascadeNutritionEvents(clientId, data.targetDate);

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.TRAINING_PLAN_PLACE,
      targetTable: "training_sessions",
      targetId: result.sessionId,
      clientId,
      metadata: { savedSessionId: data.savedSessionId, targetDate: data.targetDate },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        sessionId: result.sessionId,
        eventId: result.eventId,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to place from library";

    if (message.includes("outside the current phase")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Only saved plans")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Error placing from library:", error);
    return NextResponse.json({ error: "Failed to place from library" }, { status: 500 });
  }
}

// --- Nutrition cascade (matches duplicate-week pattern) ---

async function cascadeNutritionEvents(clientId: string, fromDate: string) {
  const { data: nutritionPlans } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, status")
    .eq("client_id", clientId)
    .in("status", ["active", "planned"]);

  for (const np of nutritionPlans ?? []) {
    const effectiveFrom = np.status === "active" ? fromDate : undefined;
    await regenerateFutureNutritionEvents(clientId, np.id, effectiveFrom).catch((err) =>
      captureApiError(err, {
        action: "cascade-nutrition-events-from-library-placement",
        planId: np.id,
      })
    );
  }
}
