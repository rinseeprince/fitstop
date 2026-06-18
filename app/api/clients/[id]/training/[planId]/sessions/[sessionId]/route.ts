import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById, updateSession, deleteSession, updateSurplusForFutureEvents } from "@/services/training-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { updateSessionSchema } from "@/lib/validations/training";
import { getClientTodayString } from "@/services/today-service";

// GET - Fetch a single session (with exercises) for the calendar drawer.
// The drawer needs to resolve sessions from coexisting (non-active) plans whose
// sessions aren't in the active plan's session list, so it fetches by id here.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId, sessionId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // getTrainingPlanById already loads sessions + exercises.
    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const session = plan.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, session }, { status: 200 });
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

// PATCH - Update session
// Events are NOT regenerated here — the coach triggers regeneration
// via the "Done" button which calls /regenerate-events with an effective date.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
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

    const { id: clientId, planId, sessionId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const sessionExists = plan.sessions.some((s) => s.id === sessionId);
    if (!sessionExists) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = updateSessionSchema.safeParse(body);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const session = await updateSession(sessionId, validation.data);

    // Surplus % changes propagate to every future scheduled event with this
    // session_id + trigger a nutrition cascade so calorie targets reflect
    // the new training-day load. Other session fields (name, focus, etc.)
    // don't affect nutrition and don't need this cascade.
    if (validation.data.calorieSurplusPercentage !== undefined) {
      // Client-local today: "future" events live on the CLIENT's calendar, so
      // the surplus update + nutrition cascade anchor to the client's day.
      const today = await getClientTodayString(clientId);
      await updateSurplusForFutureEvents(
        sessionId,
        validation.data.calorieSurplusPercentage ?? null,
        today,
      );
      await cascadeNutritionAfterTrainingChange(
        clientId,
        today,
        "cascade-nutrition-from-session-surplus-edit",
      );
    }

    return NextResponse.json({ success: true, session }, { status: 200 });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}

// DELETE - Delete session
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
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

    const { id: clientId, planId, sessionId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const sessionExists = plan.sessions.some((s) => s.id === sessionId);
    if (!sessionExists) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await deleteSession(sessionId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
