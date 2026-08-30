import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import { saveCheckInTemplateSchema } from "@/lib/validations/check-in-form";
import {
  CheckInFormError,
  createCheckInFormTemplate,
  listCheckInFormTemplates,
} from "@/services/check-in-form-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";

/**
 * The coach's library of reusable check-in forms (#4).
 *
 * **Templates are COPIED onto a client, never referenced live** (ARCHITECTURE:
 * the library model is copy-based). The GET therefore returns each template's
 * whole content — fields and questions — because applying one REPLACES the
 * editor's state in the browser and the coach then commits it through
 * `PUT /api/clients/[id]/check-in-form`. There is deliberately no server-side
 * apply route: a template is a starting point the coach reviews, not a write
 * that lands behind their back.
 */

export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const auth = await requireCoachAuth(request);
    if (!auth.authorized) return auth.response;

    const templates = await listCheckInFormTemplates(auth.coachId);

    return NextResponse.json(
      { success: true, data: { templates } },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { action: "check-in-form-templates-list" });
    return NextResponse.json(
      { success: false, error: "Failed to load your templates" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireCoachAuth(request);
    if (!auth.authorized) return auth.response;

    const body: unknown = await request.json();
    const validation = saveCheckInTemplateSchema.safeParse(body);
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

    const { name, fields, questions } = validation.data;
    const templateId = await createCheckInFormTemplate(auth.coachId, name, {
      fields,
      questions,
    });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.CHECK_IN_FORM_TEMPLATE_CREATE,
      targetTable: "check_in_forms",
      targetId: templateId,
      // A template belongs to the coach, not to a client — the tenant column
      // is legitimately null here (recordAuditEvent accepts that).
      clientId: null,
      metadata: { fieldCount: fields.length, questionCount: questions.length },
      request,
    });

    return NextResponse.json(
      { success: true, data: { templateId } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CheckInFormError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 }
      );
    }
    captureApiError(error, { action: "check-in-form-template-create" });
    return NextResponse.json(
      { success: false, error: "Failed to save the template" },
      { status: 500 }
    );
  }
}
