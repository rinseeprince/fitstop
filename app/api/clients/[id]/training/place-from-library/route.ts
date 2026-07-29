import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { DateOccupiedError } from "@/services/training-event-occupancy";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  placePlanOnCalendar,
  placeSessionOnCalendar,
  placeInlineEditedPlanOnCalendar,
} from "@/services/library-placement-service";
import { getClientTodayString } from "@/services/today-service";
import { cascadeNutritionAfterTrainingChange, type NutritionRegenScope } from "@/services/nutrition-event-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { inlinePlanBodySchema } from "@/lib/validations/training";
import { z } from "zod";

// A full-length placement clones many sessions + generates a year of events row
// by row; give it more headroom than the platform default. NOT a correctness
// guarantee — the placement snapshots + compensates on failure (H3) — but it
// shrinks the timeout window on the riskier of the two destructive flows.
export const maxDuration = 60;

const placeFromLibrarySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("plan"),
    savedPlanId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  }),
  // Apply an edited working copy without overwriting the library template. No
  // savedPlanId field: the inline path structurally cannot accept/trust a
  // template id from the body (placed with saved_plan_id = NULL).
  z.object({
    type: z.literal("inline"),
    plan: inlinePlanBodySchema,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
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
    const coachId = await getAuthenticatedCoachId(request);
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
      });

      // Nutrition cascade: a whole-program placement is open-ended forward.
      await cascadeNutritionEvents(clientId, { kind: "from", from: data.startDate });

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

    if (data.type === "inline") {
      // Same client-local "past" guard as the plan branch — it lives here, not
      // in the service/RPC, so it must be re-run for this branch.
      const clientToday = await getClientTodayString(clientId);
      if (data.startDate < clientToday) {
        return NextResponse.json(
          {
            error: `Start date ${data.startDate} has already passed for this client (their local date is ${clientToday}).`,
          },
          { status: 400 }
        );
      }

      const result = await placeInlineEditedPlanOnCalendar({
        plan: data.plan,
        coachId,
        clientId,
        startDate: data.startDate,
      });

      // Nutrition cascade: a whole-program placement is open-ended forward.
      await cascadeNutritionEvents(clientId, { kind: "from", from: data.startDate });

      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.TRAINING_PLAN_PLACE,
        targetTable: "training_plans",
        targetId: result.planId,
        clientId,
        metadata: { inline: true, startDate: data.startDate },
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

    // Nutrition cascade: one dropped session changes exactly its target day.
    await cascadeNutritionEvents(clientId, { kind: "dates", dates: [data.targetDate] });

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
    if (error instanceof DateOccupiedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Failed to place from library";

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

// --- Nutrition cascade ---
// Thin wrapper so each placement call site keeps threading its own scope onto the
// shared cascade helper. A whole-program placement is open-ended forward from its
// start date; dropping ONE saved session touches exactly its target day.

async function cascadeNutritionEvents(
  clientId: string,
  scope: NutritionRegenScope
) {
  await cascadeNutritionAfterTrainingChange(
    clientId,
    scope,
    "cascade-nutrition-events-from-library-placement"
  );
}
