import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { setGoalDeadline } from "@/services/client-goal-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { goalWriteErrorResponse, type GoalWriteAttempt } from "@/lib/goals/goal-write-response";
import { goalDeadlineSchema } from "@/lib/validations/client-goals";

type Params = { params: Promise<{ id: string; goalId: string }> };

/**
 * A goal's deadline changed, keeping the goal: recorded against it from today,
 * or — for a goal that has not started — its deadline rewritten. `null` means
 * no deadline.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  let attempt: GoalWriteAttempt = {};
  try {
    const { id: clientId, goalId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const validation = goalDeadlineSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    attempt = { deadline: validation.data.deadline };

    const changed = await setGoalDeadline({
      goalId,
      clientId,
      today: await getClientTodayString(clientId),
      setBy: auth.coachId,
      deadline: validation.data.deadline,
    });

    if (changed) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.GOAL_DEADLINE,
        targetTable: "client_goals",
        targetId: goalId,
        clientId,
        request,
      });
    }

    return NextResponse.json({ success: true, data: await getGoalsOverview(clientId) });
  } catch (error) {
    return goalWriteErrorResponse(error, attempt);
  }
}
