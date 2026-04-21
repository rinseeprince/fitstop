import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { cloneSavedPlanAsDraft } from "@/services/coach-library-service";

// POST - Clone a saved library plan into a new draft owned by the same coach.
// The source plan is untouched; the returned draft is editable and can be
// applied to a client without mutating the library template.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedPlanId: string }> },
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
    const newPlanId = await cloneSavedPlanAsDraft(savedPlanId, coachId);

    return NextResponse.json({ success: true, savedPlanId: newPlanId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fork plan";
    console.error("Error forking saved plan:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
