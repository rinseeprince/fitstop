import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanById,
  updateTrainingPlan,
  archiveTrainingPlan,
} from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { updateTrainingPlanSchema } from "@/lib/validations/training";

// GET - Get specific training plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
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
  const rateLimitResult = apiRateLimit(request);
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

    const existingPlan = await getTrainingPlanById(planId);
    if (!existingPlan || existingPlan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = updateTrainingPlanSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
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
  const rateLimitResult = apiRateLimit(request);
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

    const existingPlan = await getTrainingPlanById(planId);
    if (!existingPlan || existingPlan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    await archiveTrainingPlan(planId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error archiving training plan:", error);
    return NextResponse.json({ error: "Failed to archive plan" }, { status: 500 });
  }
}
