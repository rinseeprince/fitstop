import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  getSavedPlanById,
  updateSavedPlan,
  deleteSavedPlan,
} from "@/services/coach-saved-plan-service";
import { updateSavedPlanSchema } from "@/lib/validations/training";

type Params = { params: Promise<{ savedPlanId: string }> };

// GET - Get a single saved plan with sessions and exercises
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedPlanId } = await params;
    const plan = await getSavedPlanById(savedPlanId, coachId);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, plan }, { status: 200 });
  } catch (error) {
    console.error("Error fetching saved plan:", error);
    return NextResponse.json({ error: "Failed to fetch saved plan" }, { status: 500 });
  }
}

// PATCH - Update plan metadata
export async function PATCH(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedPlanId } = await params;
    const body = await request.json();

    const parsed = updateSavedPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    await updateSavedPlan(savedPlanId, coachId, parsed.data);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating saved plan:", error);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

// DELETE - Delete a saved plan and its children
export async function DELETE(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedPlanId } = await params;
    await deleteSavedPlan(savedPlanId, coachId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting saved plan:", error);
    return NextResponse.json({ error: "Failed to delete saved plan" }, { status: 500 });
  }
}
