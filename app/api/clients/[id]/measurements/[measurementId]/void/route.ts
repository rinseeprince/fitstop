import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { voidMeasurementSchema } from "@/lib/validations/measurements";
import { measurementEditErrorResponse } from "@/lib/measurements/edit-errors";
import { voidMeasurement } from "@/services/measurement-edits-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

const uuid = z.string().uuid();

// Remove a reading: a void mark through the migration-160 RPC, never a
// delete. The row leaves every figure and every client surface through the
// live view and stays in the coach's list, muted, restorable (ARCHITECTURE →
// "client_measurements table", rule 8). The body is optional — the coach UI
// sends none; a later client route may send a reason.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; measurementId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, measurementId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    if (!uuid.safeParse(measurementId).success) {
      return NextResponse.json({ success: false, error: "Reading not found." }, { status: 404 });
    }

    const raw = await request.text();
    let body: unknown = {};
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ success: false, error: "Invalid input" }, { status: 400 });
      }
    }
    const validation = voidMeasurementSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const result = await voidMeasurement({
      clientId,
      measurementId,
      actor: auth.coachId,
      reason: validation.data.reason,
    });

    // Metric only: the value is health data and stays out.
    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.MEASUREMENT_VOID,
      targetTable: "client_measurements",
      targetId: measurementId,
      clientId,
      metadata: { metricKey: result.metricKey },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: result.id,
          metricKey: result.metricKey,
          sourceId: result.sourceId,
          energy: result.energy,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const refused = measurementEditErrorResponse(error);
    if (refused) return refused;
    console.error("Error removing measurement:", error);
    return NextResponse.json({ error: "Failed to remove the reading" }, { status: 500 });
  }
}
