import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { getCoachPendingIntakes } from "@/services/client-intake-service";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const intakes = await getCoachPendingIntakes(coachId);

    return NextResponse.json({ success: true, data: intakes });
  } catch (error) {
    console.error("Error fetching pending intakes:", error);
    return NextResponse.json(
      { error: "Failed to fetch pending intakes" },
      { status: 500 }
    );
  }
}
