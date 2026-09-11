import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { clearNutritionPlanById } from "@/services/nutrition-plan-clear-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// DELETE - End ONE nutrition version from the block card: a running one ends
// yesterday and keeps its past, a queued one is archived, and the hand edits
// on the days it uncovers go with it (`clearNutritionPlanById` — the same
// retire path the calendar's delete and the block delete run). Deleting one
// version never touches another: the running version beside it and the
// queued version after it stand, and nothing regrows. The nutrition twin of
// `DELETE /api/clients/[id]/training/[planId]`.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, planId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    // Client-local today: the version's standing — running or queued — and
    // the day it ends on are the client's calendar's, not the server's clock.
    const clientToday = await getClientTodayString(clientId);

    // The version is proved to belong to the client inside the service's own
    // select; a foreign id, an archived version and a finished one all read
    // as not found rather than leaking that the row exists.
    const result = await clearNutritionPlanById(clientId, clientToday, planId);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Nutrition targets not found" },
        { status: 404 }
      );
    }

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.NUTRITION_PLAN_VERSION_DELETE,
      targetTable: "nutrition_plans",
      targetId: planId,
      clientId,
      metadata: { outcome: result.outcome, editsCleared: result.editsCleared },
      request,
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    console.error("Error ending nutrition version:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete nutrition targets" },
      { status: 500 }
    );
  }
}
