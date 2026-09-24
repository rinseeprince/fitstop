import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { addGoal } from "@/services/client-goal-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { GOAL_TYPE_SETTINGS } from "@/lib/goals/goal-types";
import { goalWriteErrorResponse, type GoalWriteAttempt } from "@/lib/goals/goal-write-response";
import { addGoalSchema } from "@/lib/validations/client-goals";

type Params = { params: Promise<{ id: string }> };

/**
 * Today's goal — with the readings its progress runs from — the planned ones,
 * and the client's today.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const overview = await getGoalsOverview(clientId);
    return NextResponse.json(
      { success: true, data: overview },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching goals:", error);
    return NextResponse.json({ error: "Failed to fetch goals" }, { status: 500 });
  }
}

/**
 * A goal from today, or planned from a later day (`startsOn`). The name
 * defaults to the type's.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  let attempt: GoalWriteAttempt = {};
  try {
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const validation = addGoalSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    const body = validation.data;
    attempt = { startsOn: body.startsOn, deadline: body.deadline };

    const today = await getClientTodayString(clientId);
    const startsOn = body.startsOn ?? today;
    const goalId = await addGoal({
      clientId,
      today,
      startsOn,
      source: "coach",
      setBy: auth.coachId,
      type: body.type,
      name: body.name ?? GOAL_TYPE_SETTINGS[body.type].name,
      targetWeight: body.targetWeight ?? null,
      targetBodyFatPercentage: body.targetBodyFatPercentage ?? null,
      description: body.description ?? null,
      deadline: body.deadline ?? null,
    });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.GOAL_CREATE,
      targetTable: "client_goals",
      targetId: goalId,
      clientId,
      metadata: { startsOn, planned: startsOn > today },
      request,
    });

    return NextResponse.json(
      { success: true, data: await getGoalsOverview(clientId) },
      { status: 201 }
    );
  } catch (error) {
    return goalWriteErrorResponse(error, attempt);
  }
}
