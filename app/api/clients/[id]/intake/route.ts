import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getIntake } from "@/services/client-intake-service";
import { saveCoachNotes, reviewIntake, syncMetricsToClient } from "@/services/intake-review-service";
import { reviewIntakeSchema, intakeActionSchema } from "@/lib/validations/client-intake";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const intake = await getIntake(clientId);
    if (!intake) {
      return NextResponse.json({ success: false, error: "No intake found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: intake });
  } catch (error) {
    console.error("Error fetching client intake:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch intake" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfResult = await requireCSRFProtection(request);
  if (csrfResult) return csrfResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = reviewIntakeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    await saveCoachNotes(clientId, parsed.data.coachReviewNotes ?? "");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving coach notes:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save notes" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfResult = await requireCSRFProtection(request);
  if (csrfResult) return csrfResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = intakeActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    if (parsed.data.action === "review") {
      const intake = await reviewIntake(clientId, coachId, parsed.data.notes);
      return NextResponse.json({ success: true, data: intake });
    }

    if (parsed.data.action === "sync-metrics") {
      const syncedFields = await syncMetricsToClient(clientId);
      // CONVENTIONS §8 "when to log": intake metrics sync. Fire-and-forget,
      // after the authorized write — it records, never gates. (This lived on a
      // caller-less sub-route until the 2026-08 dead-code sweep removed it.)
      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.INTAKE_SYNC_METRICS,
        targetTable: "clients",
        targetId: clientId,
        clientId,
        request,
      });
      return NextResponse.json({ success: true, data: { syncedFields } });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error processing intake action:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process action" },
      { status: 500 }
    );
  }
}
