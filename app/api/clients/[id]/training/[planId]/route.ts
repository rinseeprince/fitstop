import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById, updateTrainingPlan } from "@/services/training-service";
import { cancelFutureEventsForPlan } from "@/services/training-event-service";
import { retireTrainingPlans } from "@/services/training-plan-clear-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getClientTodayString } from "@/services/today-service";
import { updateTrainingPlanSchema } from "@/lib/validations/training";

// GET - Get specific training plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

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

    return NextResponse.json({ success: true, plan }, { status: 200 });
  } catch (error) {
    console.error("Error fetching training plan:", error);
    return NextResponse.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

// PATCH - Update training plan
export async function PATCH(
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

    const existingPlan = await getTrainingPlanById(planId);
    if (!existingPlan || existingPlan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = updateTrainingPlanSchema.safeParse(body);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const plan = await updateTrainingPlan(planId, validation.data);

    return NextResponse.json({ success: true, plan }, { status: 200 });
  } catch (error) {
    console.error("Error updating training plan:", error);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

// DELETE - End one training plan: a running one ends yesterday and keeps its
// past, a queued one is archived, a finished one is untouched (migration 167).
export async function DELETE(
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

    const existingPlan = await getTrainingPlanById(planId);
    if (!existingPlan || existingPlan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Client-local today: "future" events on the client's calendar are
    // anchored to the client's day, not the server's UTC clock.
    const today = await getClientTodayString(clientId);
    // The shared deletion floor: today, or tomorrow if the client has already
    // touched today.
    const deleteFrom = await resolveEventDeletionFloor(clientId, today);

    // The same rule the client-level clear applies to every program: the
    // columns are NOT NULL on the row, so the fallbacks below are type belts.
    await retireTrainingPlans(
      [
        {
          id: planId,
          effective_from: existingPlan.effectiveFrom ?? today,
          effective_until: existingPlan.effectiveUntil ?? today,
        },
      ],
      today
    );
    await cancelFutureEventsForPlan(planId, deleteFrom);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error ending training plan:", error);
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}
