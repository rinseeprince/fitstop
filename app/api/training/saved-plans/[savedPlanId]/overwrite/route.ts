import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  overwriteSavedPlan,
  type OverwriteSavedPlanInput,
} from "@/services/coach-saved-plan-service";
import { overwriteSavedPlanSchema } from "@/lib/validations/training";

/**
 * POST - Replace a saved plan's sessions + exercises with a new working-copy
 * structure. Called by the DraftEditor's "Save and Update Plan" button when a
 * coach has been editing an in-memory working copy of a saved plan and wants
 * to commit those edits to the library template.
 *
 * This does NOT affect any client's applied calendar — training_events
 * reference training_sessions, which are independent of coach_saved_sessions.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedPlanId: string }> },
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
    const body = await request.json();

    const parsed = overwriteSavedPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 },
      );
    }

    await overwriteSavedPlan(savedPlanId, coachId, parsed.data as OverwriteSavedPlanInput);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error overwriting saved plan:", error);
    return NextResponse.json({ error: "Failed to overwrite plan" }, { status: 500 });
  }
}
