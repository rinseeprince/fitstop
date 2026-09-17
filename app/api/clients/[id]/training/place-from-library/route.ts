import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { BlocksUnreadableError } from "@/services/client-blocks-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  placePlanOnCalendar,
  placeSessionOnCalendar,
  placeInlineEditedPlanOnCalendar,
  PlacementSupersedeError,
} from "@/services/library-placement-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { formatDateOnlyShort } from "@/lib/date-helpers";
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
 * A program may not start before the deletion floor: the client's today, or
 * tomorrow once they have logged a WORKOUT today. A meal moves nothing —
 * today's targets are the coach's to replace, and nutrition asks no floor
 * (owner, 2026-09-11).
 *
 * "Past" is judged against the client's local today (the placement RPC's own
 * p_today anchor), never the coach's device or server UTC. The floor is the
 * one the training removals remove days from — ONE function, both directions,
 * so a day the client has trained can be neither emptied nor re-prescribed.
 * There is no override: placing onto a trained day used to be a warn-and-override,
 * and the override wrote the program's first session BESIDE the completed one
 * (the walk's upsert arbitrates on (client_id, training_session_id, date) and
 * the completed event belongs to another session row), which the check-in
 * then counted as a missed session.
 *
 * Lives at the route, where the past-date guard has always lived, and both
 * program branches call it.
 */
async function refuseStartBeforeFloor(
  clientId: string,
  clientName: string,
  startDate: string
): Promise<NextResponse | null> {
  const clientToday = await getClientTodayString(clientId);
  if (startDate < clientToday) {
    return NextResponse.json(
      {
        error: `Start date ${startDate} has already passed for this client (their local date is ${clientToday}).`,
      },
      { status: 400 }
    );
  }

  const floor = await resolveEventDeletionFloor(clientId, clientToday);
  if (startDate < floor) {
    return NextResponse.json(
      {
        error: `${clientName} has already logged ${formatDateOnlyShort(clientToday)}. A plan can start from ${formatDateOnlyShort(floor)}.`,
      },
      { status: 400 }
    );
  }

  return null;
}

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
      const refused = await refuseStartBeforeFloor(clientId, client.name, data.startDate);
      if (refused) return refused;

      const result = await placePlanOnCalendar({
        savedPlanId: data.savedPlanId,
        coachId,
        clientId,
        startDate: data.startDate,
      });

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
      // The same guard as the plan branch — it lives here, not in the
      // service/RPC, so it must be re-run for this branch.
      const refused = await refuseStartBeforeFloor(clientId, client.name, data.startDate);
      if (refused) return refused;

      const result = await placeInlineEditedPlanOnCalendar({
        plan: data.plan,
        coachId,
        clientId,
        startDate: data.startDate,
      });

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
    // The window is resolved before anything is written, so a blocks read that
    // failed refuses the placement outright: a program laid without the block's
    // end would run straight through it.
    if (error instanceof BlocksUnreadableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    // The program IS on the calendar; only the earlier program's later
    // sessions survived. Say exactly that rather than "failed to place".
    if (error instanceof PlacementSupersedeError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
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
