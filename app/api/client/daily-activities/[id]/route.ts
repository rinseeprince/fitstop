import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { dailyExternalActivitySchema } from "@/lib/validations/daily-activity";
import { updateActivity, deleteActivity } from "@/services/daily-activities-service";

// IDOR: updateActivity / deleteActivity verify the resource belongs to this client.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { id: activityId } = await params;
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
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
        },
        { status: 400 }
      );
    }

    const activity = await updateActivity(activityId, auth.clientId, validationResult.data);

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
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { id: activityId } = await params;

    await deleteActivity(activityId, auth.clientId);

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