import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { createMeasurementSchema } from "@/lib/validations/measurements";
import { appendMeasurements } from "@/services/measurements-service";
import { getCoachTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// Log a reading: the Journey's Log measurement appends a coach's reading of
// one body measurement to the measurement log (ARCHITECTURE →
// "client_measurements table"). The value arrives canonical — the dialog
// converts from the viewer's unit — and appends as it came; the log's rules
// decide the rest (rule 3 writes nothing for the day's standing value, and the
// energy pair recomputes when the reading is the client's newest).
export async function POST(
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

    const body: unknown = await request.json();
    const validation = createMeasurementSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    const { metricKey, value, recordedOn, note } = validation.data;

    // "Today" is the coach's calendar, and the zod schema stays format-only. A
    // coach ahead of the client's time zone can therefore date a reading on the
    // client's tomorrow (TECHNICAL-DEBT → "Measurement log — follow-ups").
    const coachToday = await getCoachTodayString(auth.coachId);
    if (recordedOn > coachToday) {
      return NextResponse.json(
        { success: false, error: "Entry date cannot be in the future" },
        { status: 400 }
      );
    }

    const result = await appendMeasurements({
      clientId,
      source: "coach_entry",
      recordedOn,
      values: { [metricKey]: value },
      note: note ?? null,
      createdBy: auth.coachId,
    });
    const reading = result.rows[metricKey];
    if (!reading) throw new Error("Failed to save measurement");

    // Only a written reading is audited — an unchanged value wrote nothing.
    // Metric and date only: the value is health data and stays out.
    if (result.inserted.includes(metricKey)) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.MEASUREMENT_CREATE,
        targetTable: "client_measurements",
        targetId: reading.id,
        clientId,
        metadata: { metricKey, date: reading.date },
        request,
      });
    }

    // 200, not 201: a value equal to the day's standing coach reading writes
    // nothing (rule 3), and the answer is the reading that stands either way.
    return NextResponse.json({ success: true, data: reading }, { status: 200 });
  } catch (error) {
    console.error("Error logging measurement:", error);
    return NextResponse.json({ error: "Failed to log measurement" }, { status: 500 });
  }
}
