import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { dailyExternalActivitySchema } from "@/lib/validations/daily-activity";
import { addActivity, getActivities, getActivitiesRange } from "@/services/daily-activities-service";
import { getTodayDateString } from "@/lib/date-helpers";

export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      activityName: rawBody.activityName ?? rawBody.activity_name,
      intensityLevel: rawBody.intensityLevel ?? rawBody.intensity_level,
      durationMinutes: rawBody.durationMinutes ?? rawBody.duration_minutes,
      estimatedCalories: rawBody.estimatedCalories ?? rawBody.estimated_calories,
    };
    
    const validationResult = dailyExternalActivitySchema.safeParse(normalizedBody);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
        },
        { status: 400 }
      );
    }

    const activity = await addActivity(auth.clientId, validationResult.data);

    return NextResponse.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error("Error adding activity:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to add activity",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let activities: any[];

    if (date) {
      activities = await getActivities(auth.clientId, date);
    } else if (startDate && endDate) {
      activities = await getActivitiesRange(auth.clientId, startDate, endDate);
    } else {
      const today = getTodayDateString();
      activities = await getActivities(auth.clientId, today);
    }

    return NextResponse.json({
      success: true,
      data: activities,
    });
  } catch (error) {
    console.error("Error fetching activities:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch activities",
      },
      { status: 500 }
    );
  }
}