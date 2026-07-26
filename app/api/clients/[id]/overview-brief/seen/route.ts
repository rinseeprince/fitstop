import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { upsertLastViewed } from "@/services/coach-client-views-service";

// "Mark seen": advances the coach's last_viewed_at anchor for this client.
// Split out of GET …/overview-brief (previously a sanctioned GET side effect)
// so the activity feed clears only when the coach says so. No request body.
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

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const lastViewedAt = await upsertLastViewed(auth.coachId, clientId);

    return NextResponse.json(
      { success: true, data: { lastViewedAt } },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error recording overview view:", error);
    return NextResponse.json(
      { error: "Failed to record view" },
      { status: 500 }
    );
  }
}
