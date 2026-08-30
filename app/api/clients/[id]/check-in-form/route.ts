import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { saveCheckInFormSchema } from "@/lib/validations/check-in-form";
import {
  CheckInFormError,
  getCoachClientCheckInForm,
  saveClientCheckInForm,
} from "@/services/check-in-form-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";

/**
 * The coach's per-client check-in form (#4).
 *
 * This route never touches a `clients` column. `updateClientCheckInConfig` is
 * a FULL REPLACE of the four scheduling columns, so a form save routed through
 * it would clear the client's `next_check_in_due` — the form lives in its own
 * tables precisely so that cannot happen (ARCHITECTURE: "Two writers, and only
 * two").
 */

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

    const form = await getCoachClientCheckInForm(clientId);

    return NextResponse.json(
      { success: true, data: form },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { action: "check-in-form-get" });
    return NextResponse.json(
      { success: false, error: "Failed to load the check-in form" },
      { status: 500 }
    );
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

    const body: unknown = await request.json();
    const validation = saveCheckInFormSchema.safeParse(body);
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

    await saveClientCheckInForm(auth.coachId, clientId, validation.data);
    const form = await getCoachClientCheckInForm(clientId);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.CHECK_IN_FORM_UPDATE,
      targetTable: "check_in_forms",
      clientId,
      metadata: {
        fieldCount: validation.data.fields.length,
        questionCount: validation.data.questions.length,
      },
      request,
    });

    return NextResponse.json({ success: true, data: form }, { status: 200 });
  } catch (error) {
    // The RPC's own refusals are the coach's mistake, not a server fault.
    if (error instanceof CheckInFormError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 }
      );
    }
    captureApiError(error, { action: "check-in-form-save" });
    return NextResponse.json(
      { success: false, error: "Failed to save the check-in form" },
      { status: 500 }
    );
  }
}
