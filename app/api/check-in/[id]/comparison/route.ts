import { NextRequest, NextResponse } from "next/server";
import { getCheckInComparison } from "@/services/comparison-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: checkInId } = await params;

    // Verify coach owns this check-in's client
    const auth = await requireCoachOwnsCheckIn(checkInId);
    if (!auth.authorized) return auth.response;

    const response = await getCheckInComparison(checkInId);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching check-in comparison:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
