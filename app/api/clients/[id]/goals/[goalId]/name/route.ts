import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { renameGoal } from "@/services/client-goal-writes-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { goalWriteErrorResponse } from "@/lib/goals/goal-write-response";
import { renameGoalSchema } from "@/lib/validations/client-goals";

type Params = { params: Promise<{ id: string; goalId: string }> };

/** A goal's labels — its name and description — on any goal. */
export async function PUT(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, goalId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const validation = renameGoalSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const changed = await renameGoal({ goalId, clientId, ...validation.data });

    if (changed) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.GOAL_RENAME,
        targetTable: "client_goals",
        targetId: goalId,
        clientId,
        request,
      });
    }

    return NextResponse.json({ success: true, data: await getGoalsOverview(clientId) });
  } catch (error) {
    return goalWriteErrorResponse(error);
  }
}
