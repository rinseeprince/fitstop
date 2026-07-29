import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getCoachPendingIntakes } from "@/services/client-intake-service";

export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const intakes = await getCoachPendingIntakes(coachId);

    return NextResponse.json({ success: true, data: intakes });
  } catch (error) {
    console.error("Error fetching pending intakes:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pending intakes" },
      { status: 500 }
    );
  }
}
