import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getExerciseUsageForCoach } from "@/services/exercise-catalog-service";

// GET - Distinct-session usage counts per catalog exercise (Exercises
// library "Used in" column + "In use" stat). Static segment: wins over any
// dynamic sibling.
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const usage = await getExerciseUsageForCoach(coachId);
    return NextResponse.json({ success: true, usage }, { status: 200 });
  } catch (error) {
    console.error("Error fetching exercise usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch exercise usage" },
      { status: 500 }
    );
  }
}
