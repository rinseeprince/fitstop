import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getClientPhases,
  replaceClientPhases,
  deleteClientPhase,
  PhaseWriteError,
} from "@/services/client-phases-service";
import { computePhasesFingerprint } from "@/services/phase-fingerprint";
import { isNutritionStaleForPhases } from "@/services/nutrition-plan-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import {
  replacePhasesSchema,
  deletePhaseSchema,
} from "@/lib/validations/client-phases";
import { getClientTodayString } from "@/services/today-service";

/**
 * A client's blocks — the named stretches of their calendar, each carrying a
 * rate.
 *
 * **Blocks save independently of the goal** (execution-plan invariant 7). This
 * route must never call `updateGoals`: that function supersedes-and-inserts on
 * every call, so routing a block edit through it would mint a new goal version
 * every time a coach renamed a block.
 *
 * The elapsed-block guard lives in the service and is judged against the
 * CLIENT's today, never the coach's device date — a coach in a different zone
 * must not be able to rewrite a block the client has already lived through.
 */

/** PhaseWriteError carries its own status; anything else is a 500. */
function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof PhaseWriteError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.statusCode }
    );
  }
  console.error(`${fallback}:`, error);
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

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

    const phases = await getClientPhases(clientId);

    // Computed here, once, server-side: Session 3.6 renders a row from this
    // boolean instead of re-deriving the comparison (and its custom-macros
    // exemption) in the browser.
    const nutritionStale = await isNutritionStaleForPhases(
      clientId,
      computePhasesFingerprint(phases)
    );

    return NextResponse.json(
      { success: true, data: phases, nutritionStale },
      { status: 200 }
    );
  } catch (error) {
    return errorResponse(error, "Failed to fetch blocks");
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
    const validation = replacePhasesSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: validation.error.errors,
        },
        { status: 400 }
      );
    }

    // The client's calendar day, not the coach's — the service refuses to move
    // or remove a block that has already elapsed for the CLIENT.
    const clientToday = await getClientTodayString(clientId);
    const phases = await replaceClientPhases(
      clientId,
      validation.data,
      clientToday
    );

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.PHASE_UPDATE,
      targetTable: "client_phases",
      clientId,
      request,
    });

    return NextResponse.json({ success: true, data: phases }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "Failed to save blocks");
  }
}

export async function DELETE(
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
    const validation = deletePhaseSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: validation.error.errors,
        },
        { status: 400 }
      );
    }

    const clientToday = await getClientTodayString(clientId);
    // Deleting re-chains rather than wiping (invariant 9). `shifted` reports the
    // blocks whose dates moved, so 3.2's confirm dialog can name the actual
    // consequence before the coach commits.
    const result = await deleteClientPhase(
      clientId,
      validation.data.phaseId,
      clientToday
    );

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.PHASE_DELETE,
      targetTable: "client_phases",
      targetId: validation.data.phaseId,
      clientId,
      request,
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "Failed to delete the block");
  }
}
