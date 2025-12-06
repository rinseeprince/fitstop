import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById, replaceSessionExercises } from "@/services/training-service";
import { regenerateExercisesAI } from "@/services/training-ai-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";

// POST - Refresh exercises for all training sessions in a plan
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Filter to only training sessions (not external activities)
    const trainingSessions = plan.sessions.filter(
      (s) => s.sessionType === "training"
    );

    if (trainingSessions.length === 0) {
      return NextResponse.json(
        { error: "No training sessions to refresh" },
        { status: 400 }
      );
    }

    // Prepare input for AI
    const aiInput = {
      sessions: trainingSessions.map((s) => ({
        id: s.id,
        name: s.name,
        focus: s.focus,
        estimatedDurationMinutes: s.estimatedDurationMinutes,
        currentExerciseCount: s.exercises.length,
      })),
      clientContext: {
        name: client.name,
      },
    };

    // Generate new exercises using AI
    const { result } = await regenerateExercisesAI(aiInput);

    // Replace exercises for each session
    for (const sessionResult of result.sessions) {
      const session = trainingSessions.find((s) => s.id === sessionResult.sessionId);
      if (!session) continue;

      await replaceSessionExercises(
        sessionResult.sessionId,
        sessionResult.exercises.map((e) => ({
          name: e.name,
          sets: e.sets,
          repsMin: e.repsMin,
          repsMax: e.repsMax,
          repsTarget: e.repsTarget,
          rpeTarget: e.rpeTarget,
          percentage1rm: e.percentage1rm,
          tempo: e.tempo,
          restSeconds: e.restSeconds,
          notes: e.notes,
          supersetGroup: e.supersetGroup,
          isWarmup: e.isWarmup,
        }))
      );
    }

    // Fetch updated plan
    const updatedPlan = await getTrainingPlanById(planId);

    return NextResponse.json({ success: true, plan: updatedPlan }, { status: 200 });
  } catch (error) {
    console.error("Error refreshing exercises:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh exercises" },
      { status: 500 }
    );
  }
}
