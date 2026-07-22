import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanById,
  addExercise,
} from "@/services/training-service";
import { bulkReplaceExercises } from "@/services/training-session-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { exerciseSchema } from "@/lib/validations/training";
import { z } from "zod";

// POST - Add new exercise to session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
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

    const sessionExists = plan.sessions.some((s) => s.id === sessionId);
    if (!sessionExists) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = exerciseSchema.safeParse(body);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const exercise = await addExercise(sessionId, validation.data, coachId);

    return NextResponse.json({ success: true, exercise }, { status: 201 });
  } catch (error) {
    console.error("Error adding exercise:", error);
    return NextResponse.json({ error: "Failed to add exercise" }, { status: 500 });
  }
}

// Reuse the shared bounded exerciseSchema (which matches the training_exercises
// DB CHECKs, e.g. rpe_target >= 1) plus the two fields the bulk payload adds.
// Do NOT use savedExerciseInputSchema here: it targets coach_saved_exercises
// (rpe_target allows 0, rejected by this table's CHECK) and pulls in a
// z.string().url() videoUrl these routes deliberately strip.
const bulkExerciseSchema = z.object({
  exercises: z
    .array(
      exerciseSchema.extend({
        orderIndex: z.number().int().min(0),
        exerciseId: z.string().uuid().nullish(),
      })
    )
    .max(50),
});

// PUT - Bulk replace all exercises for a session
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
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
    // POST and clone routes). Without this, a coach could pass a sessionId from
    // another plan/client and bulkReplaceExercises would wipe + rewrite it.
    // NOTE: plan.sessions is read with .eq("is_rest", false), so this asserts a
    // *non-rest* session of this plan — rest slots (real rows since migration
    // 121) are excluded and would 404 here.
    if (!plan.sessions.some((s) => s.id === sessionId)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = bulkExerciseSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    await bulkReplaceExercises(sessionId, validation.data.exercises.map((e) => ({
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
    })), coachId, clientId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error replacing exercises:", error);
    return NextResponse.json({ error: "Failed to replace exercises" }, { status: 500 });
  }
}
