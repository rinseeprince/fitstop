import { NextRequest, NextResponse } from "next/server";
import { getActivityByName } from "@/services/activity-service";
import {
  analyzeKnownActivity,
  analyzeUnknownActivityAI,
} from "@/services/activity-ai-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { analyzeActivitySchema } from "@/lib/validations/external-activity";

// POST - Analyze activity and estimate calories
export async function POST(request: NextRequest) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = analyzeActivitySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { activityName, intensityLevel, durationMinutes, clientWeightKg } =
      validation.data;

    // Check if activity is in our database
    const knownActivity = await getActivityByName(activityName);

    let analysis;
    if (knownActivity) {
      // Use stored MET values for known activities
      analysis = analyzeKnownActivity(
        knownActivity,
        intensityLevel,
        durationMinutes,
        clientWeightKg
      );
    } else {
      // Use AI for unknown activities
      analysis = await analyzeUnknownActivityAI(
        activityName,
        intensityLevel,
        durationMinutes,
        clientWeightKg
      );
    }

    return NextResponse.json({ success: true, analysis }, { status: 200 });
  } catch (error) {
    console.error("Error analyzing activity:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to analyze activity",
      },
      { status: 500 }
    );
  }
}
