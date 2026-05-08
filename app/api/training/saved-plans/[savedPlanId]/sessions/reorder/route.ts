import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { reorderSavedSessions } from "@/services/coach-saved-session-service";
import { reorderSavedSessionsSchema } from "@/lib/validations/training";

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
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedPlanId } = await params;
    const body = await request.json();

    const parsed = reorderSavedSessionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    await reorderSavedSessions(savedPlanId, coachId, parsed.data.order);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error reordering sessions:", error);
    return NextResponse.json({ error: "Failed to reorder sessions" }, { status: 500 });
  }
}
