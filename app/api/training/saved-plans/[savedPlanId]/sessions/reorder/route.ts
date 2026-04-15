import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { reorderSavedSessions } from "@/services/coach-library-service";

// PATCH - Bulk reorder sessions within a plan
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ savedPlanId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedPlanId } = await params;
    const body = await request.json();

    if (!Array.isArray(body.order) || body.order.length === 0) {
      return NextResponse.json({ error: "Order array is required" }, { status: 400 });
    }

    await reorderSavedSessions(savedPlanId, coachId, body.order);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder sessions";
    console.error("Error reordering sessions:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
