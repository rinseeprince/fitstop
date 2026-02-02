import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import {
  addExternalActivity,
  getExternalActivitiesForPlan,
  getActivityByName,
  incrementActivityPopularity,
} from "@/services/activity-service";
import {
  analyzeKnownActivity,
  analyzeUnknownActivityAI,
} from "@/services/activity-ai-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { addExternalActivitySchema } from "@/lib/validations/external-activity";
import { weightToKg } from "@/utils/nutrition-helpers";

type RouteParams = { params: Promise<{ id: string; planId: string }> };

// POST - Add external activity to training plan
export async function POST(request: NextRequest, { params }: RouteParams) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId } = await params;
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
    const validation = addExternalActivitySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { activityName, dayOfWeek, intensityLevel, durationMinutes, notes } =
      validation.data;

    // Get client weight for calorie calculation
    const clientWeightKg = client.currentWeight
      ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
      : 70; // Default to 70kg if no weight

    // Analyze activity
    const knownActivity = await getActivityByName(activityName);
    let analysis;

    if (knownActivity) {
      analysis = analyzeKnownActivity(
        knownActivity,
        intensityLevel,
        durationMinutes,
        clientWeightKg
      );
      incrementActivityPopularity(activityName).catch(() => {});
    } else {
      analysis = await analyzeUnknownActivityAI(
        activityName,
        intensityLevel,
        durationMinutes,
        clientWeightKg
      );
    }

    // Create activity metadata
    const activityMetadata = {
      activityName,
      intensityLevel,
      durationMinutes,
      estimatedCalories: analysis.estimatedCalories,
      metValue: analysis.metValue,
      recoveryImpact: analysis.recoveryImpact,
      recoveryHours: analysis.recoveryHours,
      muscleGroupsImpacted: analysis.muscleGroupsImpacted,
    };

    // Add to plan
    const activity = await addExternalActivity(
      planId,
      { activityName, dayOfWeek, durationMinutes, notes: notes ?? undefined },
      activityMetadata
    );

    return NextResponse.json(
      {
        success: true,
        activity,
        analysis: {
          ...analysis,
          isKnownActivity: !!knownActivity,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error adding external activity:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add activity" },
      { status: 500 }
    );
  }
}

// GET - Get all external activities for a plan
export async function GET(request: NextRequest, { params }: RouteParams) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const activities = await getExternalActivitiesForPlan(planId);

    return NextResponse.json({ success: true, activities }, { status: 200 });
  } catch (error) {
    console.error("Error fetching activities:", error);
    return NextResponse.json(
      { error: "Failed to fetch activities" },
      { status: 500 }
    );
  }
}
