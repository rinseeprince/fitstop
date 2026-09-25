import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getCoachContentLibrary } from "@/services/content-item-service";
import { apiRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch content library
    const library = await getCoachContentLibrary(coachId);

    return NextResponse.json({
      success: true,
      data: library,
    });
  } catch (error) {
    console.error("Error fetching content library:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch content library" },
      { status: 500 }
    );
  }
}
