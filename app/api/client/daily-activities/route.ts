import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyExternalActivitySchema } from "@/lib/validations/daily-activity";
import { addActivity, getActivities, getActivitiesRange } from "@/services/daily-activities-service";

export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = dailyExternalActivitySchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
          validationErrors: validationResult.error.format()
        },
        { status: 400 }
      );
    }

    const activity = await addActivity(clientId, validationResult.data);

    return NextResponse.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error("Error adding activity:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to add activity",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let activities: any[];

    if (date) {
      activities = await getActivities(clientId, date);
    } else if (startDate && endDate) {
      activities = await getActivitiesRange(clientId, startDate, endDate);
    } else {
      const today = new Date().toISOString().split('T')[0];
      activities = await getActivities(clientId, today);
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
        error: error instanceof Error ? error.message : "Failed to fetch activities",
      },
      { status: 500 }
    );
  }
}