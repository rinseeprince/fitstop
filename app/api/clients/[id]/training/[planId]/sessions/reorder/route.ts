import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById, reorderSessions } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { reorderSessionsSchema } from "@/lib/validations/training";
import { regenerateFutureEvents } from "@/services/training-event-service";
import { captureApiError } from "@/lib/error-handler";

// POST - Bulk reorder sessions (update day and order)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = reorderSessionsSchema.safeParse(body.sessions);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    // Verify all sessions belong to this plan
    const planSessionIds = new Set(plan.sessions.map((s) => s.id));
    for (const update of validation.data) {
      if (!planSessionIds.has(update.sessionId)) {
        return NextResponse.json(
          { error: `Session ${update.sessionId} not found in plan` },
          { status: 400 }
        );
      }
    }

    await reorderSessions(planId, validation.data);

    await regenerateFutureEvents(clientId, planId).catch((err) =>
      captureApiError(err, { action: "regenerate-events-after-reorder", planId })
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error reordering sessions:", error);
    return NextResponse.json(
      { error: "Failed to reorder sessions" },
      { status: 500 }
    );
  }
}
