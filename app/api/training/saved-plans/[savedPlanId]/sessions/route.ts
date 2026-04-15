import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { addSavedSession } from "@/services/coach-library-service";

// POST - Add a session to a saved plan
export async function POST(
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

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Session name is required" }, { status: 400 });
    }

    const sessionId = await addSavedSession(savedPlanId, coachId, {
      name: body.name.trim(),
      focus: body.focus,
      isRest: body.isRest,
      estimatedDurationMinutes: body.estimatedDurationMinutes,
      calorieSurplusPercentage: body.calorieSurplusPercentage,
      notes: body.notes,
      sessionType: body.sessionType,
    });

    return NextResponse.json({ success: true, sessionId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add session";
    console.error("Error adding session:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
