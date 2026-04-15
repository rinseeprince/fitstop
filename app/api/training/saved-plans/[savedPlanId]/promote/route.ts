import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { promoteDraftToSaved } from "@/services/coach-library-service";

// POST - Promote a draft plan to saved status
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedPlanId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedPlanId } = await params;
    const body = await request.json();

    const saveSessionsIndividually = body.saveSessionsIndividually === true;

    const result = await promoteDraftToSaved(savedPlanId, coachId, {
      saveSessionsIndividually,
    });

    if (result.nameConflict) {
      return NextResponse.json(
        { success: false, error: result.nameConflict },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to promote plan";
    if (message === "Plan not found" || message === "Access denied") {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (message === "Plan is not a draft") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Error promoting plan:", error);
    return NextResponse.json({ error: "Failed to promote plan" }, { status: 500 });
  }
}
