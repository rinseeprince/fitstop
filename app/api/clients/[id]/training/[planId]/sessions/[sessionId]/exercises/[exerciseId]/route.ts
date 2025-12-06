import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanById,
  updateExercise,
  deleteExercise,
  getSessionWithExercises,
  updateSessionCalories,
} from "@/services/training-service";
import { estimateSessionCalories } from "@/services/training-calorie-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { updateExerciseSchema } from "@/lib/validations/training";
import { weightToKg } from "@/utils/nutrition-helpers";

type RouteParams = {
  id: string;
  planId: string;
  sessionId: string;
  exerciseId: string;
};

// PATCH - Update exercise
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId, sessionId, exerciseId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const session = plan.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const exerciseExists = session.exercises.some((e) => e.id === exerciseId);
    if (!exerciseExists) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = updateExerciseSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const exercise = await updateExercise(exerciseId, validation.data);

    // Recalculate session calories after updating exercise
    if (session.sessionType === "training") {
      const updatedSession = await getSessionWithExercises(sessionId);
      if (updatedSession) {
        const clientWeightKg = client.currentWeight
          ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
          : 70;
        const estimate = await estimateSessionCalories(updatedSession, clientWeightKg);
        await updateSessionCalories(sessionId, estimate.estimatedCalories);
      }
    }

    return NextResponse.json({ success: true, exercise }, { status: 200 });
  } catch (error) {
    console.error("Error updating exercise:", error);
    return NextResponse.json({ error: "Failed to update exercise" }, { status: 500 });
  }
}

// DELETE - Delete exercise
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId, sessionId, exerciseId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const session = plan.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const exerciseExists = session.exercises.some((e) => e.id === exerciseId);
    if (!exerciseExists) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
    }

    await deleteExercise(exerciseId);

    // Recalculate session calories after deleting exercise
    if (session.sessionType === "training") {
      const updatedSession = await getSessionWithExercises(sessionId);
      if (updatedSession) {
        const clientWeightKg = client.currentWeight
          ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
          : 70;
        const estimate = await estimateSessionCalories(updatedSession, clientWeightKg);
        await updateSessionCalories(sessionId, estimate.estimatedCalories);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting exercise:", error);
    return NextResponse.json({ error: "Failed to delete exercise" }, { status: 500 });
  }
}
