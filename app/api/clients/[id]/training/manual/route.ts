import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { createTrainingPlan, archiveTrainingPlan, getActiveTrainingPlan } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import type { TrainingSplitType, AIGeneratedPlan, AIGeneratedSession, AIGeneratedExercise } from "@/types/training";

const manualExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().min(1).max(20),
  repsTarget: z.string().optional(),
  rpeTarget: z.number().min(1).max(10).optional(),
  restSeconds: z.number().optional(),
  notes: z.string().optional(),
});

const manualSessionSchema = z.object({
  tempId: z.string(),
  name: z.string().min(1),
  dayOfWeek: z.string().optional(),
  focus: z.string().optional(),
  exercises: z.array(manualExerciseSchema),
});

const manualPlanSchema = z.object({
  name: z.string().min(1).default("Custom Training Plan"),
  splitType: z.enum(["push_pull_legs", "upper_lower", "full_body", "bro_split", "push_pull", "custom"]).default("custom"),
  frequencyPerWeek: z.number().min(1).max(7),
  sessions: z.array(manualSessionSchema).min(1),
});

// POST - Create manual training plan
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = manualPlanSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { name, splitType, frequencyPerWeek, sessions } = validation.data;

    // Archive existing active plan if any
    const existingPlan = await getActiveTrainingPlan(clientId);
    if (existingPlan) {
      await archiveTrainingPlan(existingPlan.id);
    }

    // Convert to AIGeneratedPlan format for createTrainingPlan
    const aiPlan: AIGeneratedPlan = {
      name,
      description: "Manually created training plan",
      splitType: splitType as TrainingSplitType,
      frequencyPerWeek,
      sessions: sessions.map((session): AIGeneratedSession => ({
        name: session.name,
        dayOfWeek: session.dayOfWeek,
        focus: session.focus,
        estimatedDurationMinutes: 60,
        exercises: session.exercises.map((exercise): AIGeneratedExercise => ({
          name: exercise.name,
          sets: exercise.sets,
          repsTarget: exercise.repsTarget,
          rpeTarget: exercise.rpeTarget,
          restSeconds: exercise.restSeconds,
          notes: exercise.notes,
          isWarmup: false,
        })),
      })),
    };

    // Create the plan using existing service function
    const plan = await createTrainingPlan(
      clientId,
      coachId,
      aiPlan,
      "Manual creation",
      JSON.stringify({ manual: true }),
      {}, // No client metrics snapshot for manual plans
      undefined // No check-in data
    );

    return NextResponse.json({
      success: true,
      plan,
    });
  } catch (error) {
    console.error("Error creating manual plan:", error);
    return NextResponse.json(
      { error: "Failed to create training plan" },
      { status: 500 }
    );
  }
}
