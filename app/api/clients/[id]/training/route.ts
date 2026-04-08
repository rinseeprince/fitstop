import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { aiRateLimit, coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { generateTrainingPlanSchema } from "@/lib/validations/training";
import {
  orchestrateTrainingPlanCreation,
  TrainingPlanError,
} from "@/services/training-plan-orchestrator";

// POST - Generate new training plan via AI
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await aiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    const body = await request.json();
    const validation = generateTrainingPlanSchema.safeParse(body);

    if (!validation.success) {
      console.error("Training plan validation errors:", validation.error.errors);
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const result = await orchestrateTrainingPlanCreation(clientId, coachId, {
      coachPrompt: validation.data.coachPrompt,
      phaseId: validation.data.phaseId,
      preGenerationActivities: validation.data.preGenerationActivities,
      allowSameDayTraining: validation.data.allowSameDayTraining,
      effectiveFrom: (validation.data as Record<string, unknown>).effectiveFrom as string | undefined,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TrainingPlanError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Error generating training plan:", error);
    return NextResponse.json(
      { error: "Failed to generate training plan" },
      { status: 500 }
    );
  }
}

// GET - Get active training plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
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

    const plan = await getActiveTrainingPlan(clientId);

    return NextResponse.json({ success: true, plan }, { status: 200 });
  } catch (error) {
    console.error("Error fetching training plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch training plan" },
      { status: 500 }
    );
  }
}
