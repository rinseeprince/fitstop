import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getClientCheckIns } from "@/services/check-in-service";
import { generateTrainingPlanAI, calculateCheckInAverages } from "@/services/training-ai-service";
import {
  createTrainingPlan,
  getActiveTrainingPlan,
  archiveTrainingPlan,
  saveTrainingPlanHistory,
  updateSessionCalories,
} from "@/services/training-service";
import { addExternalActivity } from "@/services/activity-service";
import { estimateSessionCalories } from "@/services/training-calorie-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { generateTrainingPlanSchema } from "@/lib/validations/training";
import { weightToKg } from "@/utils/nutrition-helpers";
import type { ExternalActivityContext, PreGenerationActivity } from "@/types/training";
import type { ActivityMetadata, MuscleGroup, IntensityLevel } from "@/types/external-activity";

// Helper function for default recovery hours based on intensity
function getDefaultRecoveryHours(intensity: IntensityLevel): number {
  switch (intensity) {
    case "low":
      return 12;
    case "moderate":
      return 24;
    case "vigorous":
      return 48;
    default:
      return 24;
  }
}

// POST - Generate new training plan via AI
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
    const validation = generateTrainingPlanSchema.safeParse(body);

    if (!validation.success) {
      console.error("Training plan validation errors:", validation.error.errors);
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // Gather client metrics
    const currentWeightKg = client.currentWeight
      ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
      : undefined;
    const goalWeightKg = client.goalWeight
      ? weightToKg(client.goalWeight, client.weightUnit || "lbs")
      : undefined;

    // Get recent check-ins for context
    const { checkIns } = await getClientCheckIns(clientId, { limit: 4 });
    const checkInData = calculateCheckInAverages(checkIns);

    // Convert pre-generation activities to external activity context for AI
    const preGenActivities = validation.data.preGenerationActivities || [];
    const externalActivities: ExternalActivityContext[] = preGenActivities.map((activity) => ({
      activityName: activity.activityName,
      dayOfWeek: activity.dayOfWeek,
      intensityLevel: activity.intensityLevel,
      durationMinutes: activity.durationMinutes,
      recoveryHours: activity.analysis?.recoveryHours || getDefaultRecoveryHours(activity.intensityLevel),
      muscleGroupsImpacted: (activity.analysis?.muscleGroupsImpacted || ["full_body"]) as MuscleGroup[],
      recoveryImpact: activity.analysis?.recoveryImpact || "",
    }));

    // Archive existing active plan if any
    const existingPlan = await getActiveTrainingPlan(clientId);
    if (existingPlan) {
      await archiveTrainingPlan(existingPlan.id);
    }

    // Generate plan via AI with external activities as context
    const { plan: aiPlan, rawResponse } = await generateTrainingPlanAI({
      coachPrompt: validation.data.coachPrompt,
      client: {
        name: client.name,
        currentWeightKg,
        goalWeightKg,
        bodyFatPercentage: client.currentBodyFatPercentage,
        goalBodyFatPercentage: client.goalBodyFatPercentage,
        tdee: client.tdee,
        bmr: client.bmr,
        gender: client.gender,
      },
      checkInData,
      externalActivities: externalActivities.length > 0 ? externalActivities : undefined,
      allowSameDayTraining: validation.data.allowSameDayTraining,
    });

    // Save to database
    const plan = await createTrainingPlan(
      clientId,
      coachId,
      aiPlan,
      validation.data.coachPrompt,
      rawResponse,
      {
        weightKg: currentWeightKg,
        bodyFatPercentage: client.currentBodyFatPercentage,
        goalWeightKg,
        tdee: client.tdee,
      },
      checkInData
    );

    // Save pre-generation activities as external activities in the plan
    for (const activity of preGenActivities) {
      const activityMetadata: ActivityMetadata = {
        activityName: activity.activityName,
        intensityLevel: activity.intensityLevel,
        durationMinutes: activity.durationMinutes,
        estimatedCalories: activity.analysis?.estimatedCalories || 0,
        metValue: activity.analysis?.metValue || 5,
        recoveryImpact: activity.analysis?.recoveryImpact || "",
        recoveryHours: activity.analysis?.recoveryHours || getDefaultRecoveryHours(activity.intensityLevel),
        muscleGroupsImpacted: (activity.analysis?.muscleGroupsImpacted || ["full_body"]) as MuscleGroup[],
      };

      await addExternalActivity(
        plan.id,
        {
          activityName: activity.activityName,
          dayOfWeek: activity.dayOfWeek,
          durationMinutes: activity.durationMinutes,
          notes: activity.notes ?? undefined,
        },
        activityMetadata
      );
    }

    // Refetch plan to include the newly added external activities
    let updatedPlan = await getActiveTrainingPlan(clientId);

    // Estimate calories for all training sessions
    if (updatedPlan) {
      for (const session of updatedPlan.sessions) {
        if (session.sessionType === "training" && session.exercises && session.exercises.length > 0) {
          const estimate = await estimateSessionCalories(session, currentWeightKg || 70);
          await updateSessionCalories(session.id, estimate.estimatedCalories);
        }
      }
      // Refetch to include updated calories
      updatedPlan = await getActiveTrainingPlan(clientId);
    }

    // Save to history
    await saveTrainingPlanHistory(
      clientId,
      plan.id,
      updatedPlan || plan,
      validation.data.coachPrompt,
      rawResponse,
      coachId,
      existingPlan ? "regenerated" : "initial"
    );

    return NextResponse.json({ success: true, plan: updatedPlan || plan }, { status: 201 });
  } catch (error) {
    console.error("Error generating training plan:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate training plan" },
      { status: 500 }
    );
  }
}

// GET - Get active training plan
export async function GET(
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
