import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { updateMeasurementSchema } from "@/lib/validations/measurements";
import { measurementEditErrorResponse } from "@/lib/measurements/edit-errors";
import { updateMeasurement } from "@/services/measurement-edits-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

const uuid = z.string().uuid();

// Edit a reading in place: the row keeps its id, day, source, check-in stamp
// and place in the day, and its value changes, so a stamped check-in's report
// follows it, and the day's value and every "now" surface follow it when it
// is the reading written last (ARCHITECTURE → "client_measurements table",
// rules 2 and 8). The value is canonical; its bounds depend on the row's
// metric, which the service alone can read.
export async function PATCH(
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

    // A malformed id is not a row of this client's: 404, not a Postgres cast error.
    if (!uuid.safeParse(measurementId).success) {
      return NextResponse.json({ success: false, error: "Reading not found." }, { status: 404 });
    }

    const body: unknown = await request.json();
    const validation = updateMeasurementSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const result = await updateMeasurement({
      clientId,
      measurementId,
      value: validation.data.value,
    });

    // Only a written change is audited — an unchanged value wrote nothing.
    // Metric and date only: the value is health data and stays out.
    if (result.updated) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.MEASUREMENT_UPDATE,
        targetTable: "client_measurements",
        targetId: result.id,
        clientId,
        metadata: { metricKey: result.metricKey, date: result.date },
        request,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: result.id,
          metricKey: result.metricKey,
          sourceId: result.sourceId,
          updated: result.updated,
          energy: result.energy,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const refused = measurementEditErrorResponse(error);
    if (refused) return refused;
    console.error("Error updating measurement:", error);
    return NextResponse.json({ error: "Failed to update the reading" }, { status: 500 });
  }
}
