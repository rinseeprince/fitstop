import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import {
  updateExternalActivity,
  deleteExternalActivity,
  getActivityByName,
} from "@/services/activity-service";
import {
  analyzeKnownActivity,
  analyzeUnknownActivityAI,
} from "@/services/activity-ai-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { updateExternalActivitySchema } from "@/lib/validations/external-activity";
import { weightToKg } from "@/utils/nutrition-helpers";

type RouteParams = {
  params: Promise<{ id: string; planId: string; activityId: string }>;
};

// PATCH - Update external activity
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId, activityId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Training plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = updateExternalActivitySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { activityName, dayOfWeek, intensityLevel, durationMinutes, notes } =
      validation.data;

    // If activity details changed, recalculate metadata
    let activityMetadata;
    if (activityName || intensityLevel || durationMinutes) {
      const clientWeightKg = client.currentWeight
        ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
        : 70;

      // Find the current activity to get existing values for unchanged fields
      const currentActivity = plan.sessions.find(
        (s) => s.id === activityId && s.sessionType === "external_activity"
      );
      const currentMetadata = currentActivity?.activityMetadata;

      const finalActivityName = activityName || currentMetadata?.activityName || "Activity";
      const finalIntensity = intensityLevel || currentMetadata?.intensityLevel || "moderate";
      const finalDuration = durationMinutes || currentMetadata?.durationMinutes || 60;

      const knownActivity = await getActivityByName(finalActivityName);
      let analysis;

      if (knownActivity) {
        analysis = analyzeKnownActivity(
          knownActivity,
          finalIntensity,
          finalDuration,
          clientWeightKg
        );
      } else {
        analysis = await analyzeUnknownActivityAI(
          finalActivityName,
          finalIntensity,
          finalDuration,
          clientWeightKg
        );
      }

      activityMetadata = {
        activityName: finalActivityName,
        intensityLevel: finalIntensity,
        durationMinutes: finalDuration,
        estimatedCalories: analysis.estimatedCalories,
        metValue: analysis.metValue,
        recoveryImpact: analysis.recoveryImpact,
        recoveryHours: analysis.recoveryHours,
        muscleGroupsImpacted: analysis.muscleGroupsImpacted,
      };
    }

    const activity = await updateExternalActivity(
      activityId,
      { activityName, dayOfWeek, durationMinutes, notes: notes ?? undefined },
      activityMetadata
    );

    return NextResponse.json({ success: true, activity }, { status: 200 });
  } catch (error) {
    console.error("Error updating activity:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update activity" },
      { status: 500 }
    );
  }
}

// DELETE - Remove external activity
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId, activityId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Training plan not found" }, { status: 404 });
    }

    await deleteExternalActivity(activityId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting activity:", error);
    return NextResponse.json(
      { error: "Failed to delete activity" },
      { status: 500 }
    );
  }
}
