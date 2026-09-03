import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { measurementEditErrorResponse } from "@/lib/measurements/edit-errors";
import { restoreMeasurement } from "@/services/measurement-edits-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

const uuid = z.string().uuid();

// Restore a removed reading: the void mark cleared through the migration-160
// RPC, the row back in every figure at once (ARCHITECTURE →
// "client_measurements table", rule 8). No body.
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

    const result = await restoreMeasurement({ clientId, measurementId });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.MEASUREMENT_RESTORE,
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
    console.error("Error restoring measurement:", error);
    return NextResponse.json({ error: "Failed to restore the reading" }, { status: 500 });
  }
}
