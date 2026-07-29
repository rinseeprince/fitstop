import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getCurrentGoals,
  updateGoals,
  getGoalsHistory,
} from "@/services/client-goals-service";
import { getClientPhases } from "@/services/client-phases-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { updateGoalsSchema } from "@/lib/validations/client-goals";
import { getCoachTodayString } from "@/services/today-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get("history") === "true";

    // Blocks ride alongside the goal rather than on their own endpoint: every
    // browser consumer of the goal (Overview chips, Metrics, the nutrition
    // builder) resolves through `resolveEffectiveGoal`, which needs both to
    // answer "what rate applies on this date". Sibling key, not folded into
    // `data`, so existing `data`-shaped consumers are untouched.
    const [current, phases] = await Promise.all([
      getCurrentGoals(clientId),
      getClientPhases(clientId),
    ]);

    if (includeHistory) {
      const history = await getGoalsHistory(clientId);
      return NextResponse.json(
        { success: true, data: { current, history }, phases },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { success: true, data: current, phases },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching goals:", error);
    return NextResponse.json(
      { error: "Failed to fetch goals" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = updateGoalsSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // Past-deadline bound (format-only schema): the coach is the setter, so the
    // honest "today" is the coach's local day — not the server's UTC clock, which
    // would reject an east-of-UTC coach's own today (the habit-log bug class).
    const { goalDeadline } = validation.data;
    if (goalDeadline) {
      const coachToday = await getCoachTodayString(auth.coachId);
      if (goalDeadline < coachToday) {
        return NextResponse.json(
          { success: false, error: "Goal deadline cannot be in the past" },
          { status: 400 }
        );
      }
    }

    const goals = await updateGoals(clientId, validation.data, auth.coachId);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.GOAL_CREATE,
      targetTable: "client_goals",
      clientId,
      request,
    });

    return NextResponse.json(
      { success: true, data: goals },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating goals:", error);
    return NextResponse.json(
      { error: "Failed to update goals" },
      { status: 500 }
    );
  }
}
