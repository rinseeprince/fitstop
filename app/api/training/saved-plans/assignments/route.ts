import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getSavedPlanAssignments } from "@/services/coach-saved-plan-service";

// GET - Live client-assignment counts per saved plan (training_plans
// provenance). Static segment: wins over [savedPlanId] in the App Router.
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const assignments = await getSavedPlanAssignments(coachId);
    return NextResponse.json({ success: true, assignments }, { status: 200 });
  } catch (error) {
    console.error("Error fetching plan assignments:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan assignments" },
      { status: 500 }
    );
  }
}
