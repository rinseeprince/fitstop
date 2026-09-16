import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { replaceSessionFull } from "@/services/training-session-replace-service";
import {
  getSessionEventLinks,
  SessionLoggedError,
} from "@/services/training-event-occupancy";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { replaceSessionSchema } from "@/lib/validations/training";
import { getClientTodayString } from "@/services/today-service";

// GET - Fetch a single session (with exercises) for the placed-session tray.
// The tray needs to resolve sessions from coexisting (non-active) plans whose
// sessions aren't in the active plan's session list, so it fetches by id here.
// `events` lets the tray show a logged session locked without a second fetch.
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

    const events = await getSessionEventLinks(sessionId, clientId);

    return NextResponse.json({ success: true, session, events }, { status: 200 });
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

// PUT - Builder-grade full replace of a placed session (meta + whole exercise
// list incl. setSpecs/videoUrl), the tray's save. A rename lands on the
// session's scheduled calendar entry from today; past keeps its snapshot. A
// surplus change re-prices that day's computed nutrition target by itself — the
// day reads the surplus off the event. The response carries the saved session,
// which the tray writes into its own read.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
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
    const validation = replaceSessionSchema.safeParse(body);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Client-local today: "future" events live on the CLIENT's calendar.
    const today = await getClientTodayString(clientId);

    const result = await replaceSessionFull({
      sessionId,
      planId,
      clientId,
      coachId,
      fromDate: today,
      input: validation.data,
    });

    return NextResponse.json({ success: true, session: result.session }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Session not found") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "Rest days cannot be edited") {
      return NextResponse.json({ error: "Rest days cannot be edited" }, { status: 400 });
    }
    // The client has logged a day this session prescribes — its exercises are
    // frozen. The service's message names the day; it IS the coach-facing copy.
    if (error instanceof SessionLoggedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // Don't echo raw error.message — it leaks Postgres CHECK-violation text.
    console.error("Error replacing session:", error);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }
}
