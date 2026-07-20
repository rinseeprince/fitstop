import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getSavedPlansSummary } from "@/services/coach-saved-plan-service";

// GET - Aggregate stats over ALL of the coach's plans for the Programs stat
// band, decoupled from list pagination (mirrors /assignments). ?status=all
// includes drafts (the Programs table surfaces them).
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const includeDrafts =
      request.nextUrl.searchParams.get("status") === "all";
    const summary = await getSavedPlansSummary(coachId, { includeDrafts });
    return NextResponse.json({ success: true, summary }, { status: 200 });
  } catch (error) {
    console.error("Error fetching saved plans summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch saved plans summary" },
      { status: 500 },
    );
  }
}
