import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientById } from "@/services/client-service";
import { BlocksUnreadableError } from "@/services/client-blocks-service";
import {
  getPlanForEditing,
  savePlanEdit,
  PlanEditInvalidError,
  PlanEditNotFoundError,
  PlanEditStaleError,
  PlanEndedError,
} from "@/services/plan-edit-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { planEditSaveSchema } from "@/lib/validations/training";

const planIdSchema = z.string().uuid();

// GET - The plan as the editor opens it: laid from the calendar, with the
// first editable day, the plan's limit and the version the save sends back.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

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

    // The read is client-scoped, so a foreign plan comes back null.
    const data = await getPlanForEditing(clientId, planId);
    if (!data) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof PlanEndedError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    // The editor's limit is the block's end, so without the blocks it cannot
    // say which days are the plan's: it refuses to open rather than offer days
    // past the block (the save refuses for the same reason).
    if (error instanceof BlocksUnreadableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Error reading the plan for editing:", error);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

// PUT - Save the editor: every day from the first editable day is rewritten
// from it, every session of a day in order, in one transaction that refuses
// when the calendar changed.
export async function PUT(
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

    const validation = planEditSaveSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const result = await savePlanEdit({
      clientId,
      coachId,
      planId,
      days: validation.data.days,
      name: validation.data.plan.name,
      splitType: validation.data.plan.splitType ?? null,
      version: validation.data.version,
    });

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.TRAINING_PLAN_EDIT,
      targetTable: "training_plans",
      targetId: planId,
      clientId,
      metadata: {
        firstDay: result.firstDay,
        lastDay: result.lastDay,
        sessionsWritten: result.sessionsWritten,
      },
      request,
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof PlanEditStaleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PlanEditNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PlanEditInvalidError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // The limit is re-read before the save, so a blocks read that failed
    // refuses it: saving without the block's end could carry the plan past it.
    if (error instanceof BlocksUnreadableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    // Never echo the raw message: it can carry Postgres text.
    console.error("Error saving the plan:", error);
    return NextResponse.json({ error: "Failed to save plan changes" }, { status: 500 });
  }
}
