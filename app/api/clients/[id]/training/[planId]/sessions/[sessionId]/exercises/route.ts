import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanById,
  addExercise,
  getSessionWithExercises,
  updateSessionCalories,
} from "@/services/training-service";
import { estimateSessionCalories } from "@/services/training-calorie-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { addExerciseSchema } from "@/lib/validations/training";
import { weightToKg } from "@/utils/nutrition-helpers";

// POST - Add new exercise to session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; sessionId: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

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
    const validation = addExerciseSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const exercise = await addExercise(sessionId, validation.data);

    // Recalculate session calories after adding exercise
    const session = plan.sessions.find((s) => s.id === sessionId);
    if (session && session.sessionType === "training") {
      const updatedSession = await getSessionWithExercises(sessionId);
      if (updatedSession) {
        const clientWeightKg = client.currentWeight
          ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
          : 70;
        const estimate = await estimateSessionCalories(updatedSession, clientWeightKg);
        await updateSessionCalories(sessionId, estimate.estimatedCalories);
      }
    }

    return NextResponse.json({ success: true, exercise }, { status: 201 });
  } catch (error) {
    console.error("Error adding exercise:", error);
    return NextResponse.json({ error: "Failed to add exercise" }, { status: 500 });
  }
}
