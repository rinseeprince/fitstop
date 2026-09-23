import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { deleteGoal, editGoal } from "@/services/client-goal-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { goalWriteErrorResponse, type GoalWriteAttempt } from "@/lib/goals/goal-write-response";
import { editGoalSchema } from "@/lib/validations/client-goals";

type Params = { params: Promise<{ id: string; goalId: string }> };

/**
 * A planned goal, or today's, rewritten whole. A goal that started before
 * today is refused: it changes only its deadline and its name.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  let attempt: GoalWriteAttempt = {};
  try {
    const { id: clientId, goalId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const validation = editGoalSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    const body = validation.data;
    attempt = { startsOn: body.startsOn, deadline: body.deadline };

    const changed = await editGoal({
      goalId,
      clientId,
      today: await getClientTodayString(clientId),
      setBy: auth.coachId,
      ...body,
    });

    if (changed) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.GOAL_UPDATE,
        targetTable: "client_goals",
        targetId: goalId,
        clientId,
        metadata: { startsOn: body.startsOn },
        request,
      });
    }

    return NextResponse.json({ success: true, data: await getGoalsOverview(clientId) });
  } catch (error) {
    return goalWriteErrorResponse(error, attempt);
  }
}

/** A goal hard-deleted — any goal; the goal before it covers its days again. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, goalId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    await deleteGoal({ goalId, clientId });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.GOAL_DELETE,
      targetTable: "client_goals",
      targetId: goalId,
      clientId,
      request,
    });

    return NextResponse.json({ success: true, data: await getGoalsOverview(clientId) });
  } catch (error) {
    return goalWriteErrorResponse(error);
  }
}
