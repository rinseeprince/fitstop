import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getRecentExercisesForCoach } from "@/services/exercise-catalog-service";

// GET - Most-recently-used catalog exercises for the coach (builder picker
// "Recently used" strip). Static segment: wins over any dynamic sibling.
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recent = await getRecentExercisesForCoach(coachId);
    return NextResponse.json({ success: true, recent }, { status: 200 });
  } catch (error) {
    console.error("Error fetching recent exercises:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent exercises" },
      { status: 500 }
    );
  }
}
