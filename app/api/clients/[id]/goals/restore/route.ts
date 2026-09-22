import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsOverview } from "@/services/client-goals-service";
import { restoreGoal } from "@/services/client-goal-writes-service";
import { readGoalUndo } from "@/services/goal-undo-token";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { goalWriteErrorResponse } from "@/lib/goals/goal-write-response";
import { restoreGoalSchema } from "@/lib/validations/client-goals";

type Params = { params: Promise<{ id: string }> };

const UNDO_REFUSED = {
  invalid: { status: 400, error: "That undo isn't valid." },
  foreign: { status: 400, error: "That undo isn't valid." },
  expired: { status: 410, error: "Too late to undo — set the goal again instead." },
} as const;

/**
 * Undo a goal's delete: puts back exactly what the delete removed, from the
 * signed copy it handed out — only this server's copy, for this client, in
 * time.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const validation = restoreGoalSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const undo = readGoalUndo(validation.data.undo, clientId);
    if (!undo.ok) {
      const refused = UNDO_REFUSED[undo.reason];
      return NextResponse.json({ success: false, error: refused.error }, { status: refused.status });
    }

    const goalId = await restoreGoal({ clientId, copy: undo.copy });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.GOAL_RESTORE,
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
