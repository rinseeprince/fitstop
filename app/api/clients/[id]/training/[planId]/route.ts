import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanById,
  updateTrainingPlan,
  archiveTrainingPlan,
} from "@/services/training-service";
import { cancelFutureEventsForPlan } from "@/services/training-event-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
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

// DELETE - Archive training plan
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

    await archiveTrainingPlan(planId);
    await cancelFutureEventsForPlan(planId, today);

    // Cascade: nutrition burn estimates depend on training events.
    await cascadeNutritionAfterTrainingChange(
      clientId,
      today,
      "cascade-nutrition-events-from-clear-plan"
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error archiving training plan:", error);
    return NextResponse.json({ error: "Failed to archive plan" }, { status: 500 });
  }
}
