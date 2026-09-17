import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientById } from "@/services/client-service";
import {
  moveTrainingPlanStart,
  PlanMoveNotFoundError,
  PlanMoveRefusedError,
} from "@/services/training-plan-move-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { moveTrainingPlanSchema } from "@/lib/validations/training";

const planIdSchema = z.string().uuid();

// POST - Move a program that hasn't started to a new start date: the whole
// program — its start, its end and every session between them — shifts by the
// same number of days, or nothing moves and the answer says why.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
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

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!planIdSchema.safeParse(planId).success) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // A body that isn't JSON is invalid input, not a server failure.
    const body: unknown = await request.json().catch(() => null);
    const validation = moveTrainingPlanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // The move is client-scoped in the function, so a foreign plan is not found.
    const result = await moveTrainingPlanStart({
      clientId,
      planId,
      startsOn: validation.data.startsOn,
    });

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.TRAINING_PLAN_MOVE,
      targetTable: "training_plans",
      targetId: planId,
      clientId,
      metadata: {
        startsOn: result.startsOn,
        endsOn: result.endsOn,
        sessionsMoved: result.sessionsMoved,
      },
      request,
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    // A refusal is the service's own sentence, written for the coach.
    if (error instanceof PlanMoveRefusedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PlanMoveNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    // Never echo the raw message: it can carry Postgres text.
    console.error("Error moving the program:", error);
    return NextResponse.json({ error: "Failed to move the program" }, { status: 500 });
  }
}
