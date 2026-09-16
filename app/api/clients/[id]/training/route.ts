import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanForDate,
  getNextFutureTrainingPlan,
  getTrainingPlanById,
} from "@/services/training-service";
import { clearTrainingPlansForClient } from "@/services/training-plan-clear-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { getClientTodayString } from "@/services/today-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

// POST (one-shot AI plan generation) was removed in builder S7: its UI was
// deleted with the drawer's AI-generation mode in S5, and authoring moved to the
// Programs builder + draft assistant. GET and DELETE below are live.

// GET - The Training tab's plan read: the program the Plans hero shows, the
// program after it, and the two days its start lines are judged by.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    // "Active" is date-driven: the provenance plan whose range covers today.
    const clientToday = await getClientTodayString(clientId);

    // getTrainingPlanForDate, not getActiveTrainingPlan: the latter is just
    // getClientTodayString + getTrainingPlanForDate, so calling it here would
    // re-run the timezone query already paid for one line up. The three reads
    // take only (clientId, clientToday) and share no data, so they resolve in
    // one round trip. The queued plan comes from the shared predicate — a
    // hand-rolled copy is what let retired plans resurface here.
    const [activePlan, firstQueued, planStartFloor] = await Promise.all([
      getTrainingPlanForDate(clientId, clientToday),
      getNextFutureTrainingPlan(clientId, clientToday),
      resolveEventDeletionFloor(clientId, clientToday),
    ]);

    // The hero's program is the one covering today, else the first one queued
    // (returned as `plan`, editable in the builder). The program after it is
    // the next one to start: the first queued behind a running program, the
    // one queued behind the first when none runs. Live windows never overlap,
    // so no program starts between a running one's start and today.
    let plan = activePlan;
    let after = firstQueued;
    if (!activePlan && firstQueued) {
      const [queuedPlan, behindIt] = await Promise.all([
        getTrainingPlanById(firstQueued.id),
        getNextFutureTrainingPlan(clientId, firstQueued.effectiveFrom),
      ]);
      plan = queuedPlan;
      after = behindIt;
    }

    return NextResponse.json(
      {
        success: true,
        plan,
        nextPlan:
          plan && after
            ? { id: after.id, name: after.name, effectiveFrom: after.effectiveFrom }
            : null,
        clientToday,
        // A program starting before the floor has started, and can't move.
        planStartFloor,
        clientTimezone: client.timezone,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching training plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch training plan" },
      { status: 500 }
    );
  }
}

// DELETE - Clear ALL upcoming training sessions for the client across every
// coexisting plan ("Delete training plan"). Archives each non-archived plan
// and removes its future events; past/completed sessions are kept as history.
export async function DELETE(
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

    // Client-local today anchors the "future" cutoff on the client's calendar.
    // The act itself lives in a service because the block delete's "and its
    // plans" fires the same one — a second copy would be a second answer.
    const today = await getClientTodayString(clientId);
    const { plansCleared } = await clearTrainingPlansForClient(clientId, today);

    return NextResponse.json({ success: true, plansCleared }, { status: 200 });
  } catch (error) {
    console.error("Error clearing future training sessions:", error);
    return NextResponse.json(
      { error: "Failed to clear future sessions" },
      { status: 500 }
    );
  }
}
