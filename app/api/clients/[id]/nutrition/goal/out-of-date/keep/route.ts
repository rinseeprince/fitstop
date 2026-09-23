import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { captureApiError } from "@/lib/error-handler";
import { nutritionKeepForGoalSchema } from "@/lib/validations/nutrition";
import {
  keepNutritionForGoal,
  NutritionNoticeChangedError,
} from "@/services/nutrition-goal-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

type Params = { params: Promise<{ id: string }> };

/**
 * The out-of-date notice's ×: the coach keeps the version's calories for the
 * goal the notice compared them with (migration 197), so the notice stays
 * closed everywhere until the goal changes again. 409 when the notice has
 * changed since the coach saw it — the browser then shows the current one.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const validation = nutritionKeepForGoalSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    await keepNutritionForGoal(clientId, auth.coachId, validation.data);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.NUTRITION_PLAN_KEEP_FOR_GOAL,
      targetTable: "nutrition_plan_kept_goals",
      clientId,
      request,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof NutritionNoticeChangedError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    captureApiError(error, { action: "nutrition-keep-for-goal" });
    return NextResponse.json(
      { success: false, error: "Failed to close the notice" },
      { status: 500 }
    );
  }
}
