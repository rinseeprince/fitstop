import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { addSavedExercise } from "@/services/coach-saved-session-service";

// POST - Add an exercise to a saved session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedPlanId: string; sessionId: string }> }
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

    const { sessionId } = await params;
    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Exercise name is required" }, { status: 400 });
    }
    if (typeof body.sets !== "number" || body.sets < 1) {
      return NextResponse.json({ error: "Sets must be a positive number" }, { status: 400 });
    }

    const exerciseId = await addSavedExercise(sessionId, coachId, {
      name: body.name.trim(),
      sets: body.sets,
      repsMin: body.repsMin,
      repsMax: body.repsMax,
      repsTarget: body.repsTarget,
      rpeTarget: body.rpeTarget,
      percentage1rm: body.percentage1rm,
      tempo: body.tempo,
      restSeconds: body.restSeconds,
      supersetGroup: body.supersetGroup,
      isWarmup: body.isWarmup,
      notes: body.notes,
    });

    return NextResponse.json({ success: true, exerciseId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add exercise";
    console.error("Error adding exercise:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
