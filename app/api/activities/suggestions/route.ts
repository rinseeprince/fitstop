import { NextRequest, NextResponse } from "next/server";
import { searchActivitySuggestions } from "@/services/activity-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";

// GET - Search activity suggestions for autocomplete
export async function GET(request: NextRequest) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q") || undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 20);

    const suggestions = await searchActivitySuggestions(query, limit);

    return NextResponse.json({ success: true, suggestions }, { status: 200 });
  } catch (error) {
    console.error("Error fetching activity suggestions:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity suggestions" },
      { status: 500 }
    );
  }
}
