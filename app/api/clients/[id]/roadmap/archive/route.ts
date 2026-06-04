import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getActiveRoadmap, archiveRoadmap } from "@/services/roadmap-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const roadmap = await getActiveRoadmap(clientId);
    if (!roadmap) {
      return NextResponse.json(
        { success: false, error: "No active roadmap found" },
        { status: 404 }
      );
    }

    const archived = await archiveRoadmap(roadmap.id);

    return NextResponse.json({ success: true, data: archived }, { status: 200 });
  } catch (error) {
    console.error("Error archiving roadmap:", error);
    return NextResponse.json(
      { error: "Failed to archive roadmap" },
      { status: 500 }
    );
  }
}
