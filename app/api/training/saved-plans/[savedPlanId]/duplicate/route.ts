import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { duplicateSavedPlan } from "@/services/coach-saved-plan-service";

// POST - Deep-copy a saved plan (sessions + exercises verbatim, name deduped
// with " (copy)"). No body.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedPlanId: string }> }
) {
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
    const planId = await duplicateSavedPlan(savedPlanId, coachId);
    return NextResponse.json({ success: true, planId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Plan not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Error duplicating saved plan:", error);
    return NextResponse.json(
      { error: "Failed to duplicate program" },
      { status: 500 }
    );
  }
}
