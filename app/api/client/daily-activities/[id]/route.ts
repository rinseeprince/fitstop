import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyExternalActivitySchema } from "@/lib/validations/daily-activity";
import { updateActivity, deleteActivity } from "@/services/daily-activities-service";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: activityId } = await params;
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      activityName: rawBody.activityName ?? rawBody.activity_name,
      intensityLevel: rawBody.intensityLevel ?? rawBody.intensity_level,
      durationMinutes: rawBody.durationMinutes ?? rawBody.duration_minutes,
      estimatedCalories: rawBody.estimatedCalories ?? rawBody.estimated_calories,
    };
    
    const validationResult = dailyExternalActivitySchema.partial().safeParse(normalizedBody);

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

    const activity = await updateActivity(activityId, clientId, validationResult.data);

    return NextResponse.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error("Error updating activity:", error);
    const statusCode = error instanceof Error && error.message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update activity",
      },
      { status: statusCode }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: activityId } = await params;
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    await deleteActivity(activityId, clientId);

    return NextResponse.json({
      success: true,
      data: { message: "Activity deleted successfully" },
    });
  } catch (error) {
    console.error("Error deleting activity:", error);
    const statusCode = error instanceof Error && error.message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete activity",
      },
      { status: statusCode }
    );
  }
}