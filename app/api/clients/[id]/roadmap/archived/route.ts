import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getArchivedRoadmaps } from "@/services/roadmap-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const roadmaps = await getArchivedRoadmaps(clientId);

    return NextResponse.json({ success: true, data: roadmaps }, { status: 200 });
  } catch (error) {
    console.error("Error fetching archived roadmaps:", error);
    return NextResponse.json(
      { error: "Failed to fetch archived roadmaps" },
      { status: 500 }
    );
  }
}
