import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { createMetricEntrySchema } from "@/lib/validations/metric-entries";
import {
  listMetricEntries,
  upsertMetricEntry,
} from "@/services/metric-entries-service";
import { getCoachTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

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

    const entries = await listMetricEntries(clientId);

    return NextResponse.json(
      { success: true, data: entries },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching metric entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch metric entries" },
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

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = createMetricEntrySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // The coach is the setter, so "today" is the coach's calendar (the
    // Session 7.86 goal-deadline pattern); the zod schema stays format-only.
    const coachToday = await getCoachTodayString(auth.coachId);
    if (validation.data.entryDate > coachToday) {
      return NextResponse.json(
        { success: false, error: "Entry date cannot be in the future" },
        { status: 400 }
      );
    }

    const entry = await upsertMetricEntry(clientId, {
      ...validation.data,
      coachId: auth.coachId,
    });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.METRIC_ENTRY_UPSERT,
      targetTable: "client_metric_entries",
      targetId: entry.id,
      clientId,
      // metric + date only — measurement values are health data and stay out
      metadata: { metricKey: entry.metricKey, entryDate: entry.entryDate },
      request,
    });

    // 200 not 201: the verb is create-or-replace, not pure create.
    return NextResponse.json({ success: true, data: entry }, { status: 200 });
  } catch (error) {
    console.error("Error logging measurement:", error);
    return NextResponse.json(
      { error: "Failed to log measurement" },
      { status: 500 }
    );
  }
}
