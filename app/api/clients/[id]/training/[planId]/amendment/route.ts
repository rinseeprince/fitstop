import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getPlacedPlanForBuilder,
  amendPlacedPlanFuture,
  AmendmentConflictError,
  AmendmentValidationError,
} from "@/services/plan-amendment-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { amendPlacedPlanSchema } from "@/lib/validations/training";

// An amendment rewrites a future window row by row (sessions + exercises +
// events); give it the same headroom as placement. NOT a correctness guarantee —
// the writer snapshots + compensates on failure — but it shrinks the timeout
// window on a destructive flow.
export const maxDuration = 60;

// GET - The full-fidelity placed plan for the amendment surface (canonical
// slots incl. rest, complete exercises, per-slot event linkage, recomputed
// window, drift token, moved-events warning list). Token producer — the PUT
// below is its consumer, which is why the pair is co-located.
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

    // Plan-belongs-to-client is enforced inside the reader (client-scoped
    // query) — a foreign planId comes back null.
    const data = await getPlacedPlanForBuilder(clientId, planId);
    if (!data) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...data }, { status: 200 });
  } catch (error) {
    console.error("Error reading plan for amendment:", error);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

// PUT - Amend the placed plan's future: rewrite the remaining window to the
// incoming grid. The server recomputes the elapsed boundary and ignores
// incoming content at past positions; drift since the GET is a 409.
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

    const body = await request.json();
    const validation = amendPlacedPlanSchema.safeParse(body);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const result = await amendPlacedPlanFuture({
      clientId,
      coachId,
      planId,
      sessions: validation.data.sessions,
      planPatch: validation.data.plan,
      expectedToken: validation.data.expectedToken,
    });

    // The rewritten window's surpluses changed under the nutrition calendar —
    // re-derive from the floor (the first date the amendment touched).
    await cascadeNutritionAfterTrainingChange(
      clientId,
      result.floor,
      "cascade-nutrition-from-plan-amendment",
    );

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.TRAINING_PLAN_AMEND,
      targetTable: "training_plans",
      targetId: planId,
      clientId,
      metadata: {
        floor: result.floor,
        slotCount: validation.data.sessions.length,
        eventsCreated: result.eventsCreated,
      },
      request,
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof AmendmentConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AmendmentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof Error && error.message === "Plan not found") {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    // Don't echo raw error.message — it can carry Postgres constraint text.
    console.error("Error amending plan:", error);
    return NextResponse.json({ error: "Failed to save plan changes" }, { status: 500 });
  }
}
