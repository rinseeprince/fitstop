import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { cloneSessionForEvent } from "@/services/training-session-service";
import { bulkExerciseInputSchema } from "@/lib/validations/training";
import { z } from "zod";

// Same bounded item schema as the sibling PUT exercises route (M13) — the two
// buttons of the save-scope dialog are fed by the same payload builder and must
// validate identically.
const cloneSchema = z.object({
  eventId: z.string().uuid(),
  exercises: z.array(bulkExerciseInputSchema).max(50).optional(),
});

/**
 * POST - Clone a session for a specific event (edit-just-this-day).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
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

    const { id: clientId, planId, sessionId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Verify the sessionId actually belongs to this plan (mirrors the sibling
    // sessions/[sessionId] route). Without this, a coach could pass a sessionId
    // from another plan/client into the clone.
    if (!plan.sessions.some((s) => s.id === sessionId)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = cloneSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const exerciseOverrides = validation.data.exercises?.map((e) => ({
      ...e,
      exerciseId: e.exerciseId ?? null,
      repsMin: e.repsMin ?? null,
      repsMax: e.repsMax ?? null,
      repsTarget: e.repsTarget ?? null,
      rpeTarget: e.rpeTarget ?? null,
      restSeconds: e.restSeconds ?? null,
      tempo: e.tempo ?? null,
      percentage1rm: e.percentage1rm ?? null,
      supersetGroup: e.supersetGroup ?? null,
      notes: e.notes ?? null,
    }));

    const newSessionId = await cloneSessionForEvent(
      sessionId,
      validation.data.eventId,
      clientId,
      coachId,
      exerciseOverrides
    );

    return NextResponse.json({ success: true, newSessionId }, { status: 200 });
  } catch (error) {
    // Don't echo raw error.message — it leaks Postgres CHECK-violation text.
    console.error("Error cloning session:", error);
    return NextResponse.json({ error: "Failed to clone session" }, { status: 500 });
  }
}
