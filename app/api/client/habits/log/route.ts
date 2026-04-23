import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { dailyHabitLogSchema } from "@/lib/validations/daily-habit";
import { logHabit } from "@/services/daily-habits-service";

// IDOR: the dailyHabitId comes from the request body; logHabit() verifies the
// habit belongs to clientId before writing a log row.
export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      dailyHabitId: rawBody.dailyHabitId ?? rawBody.daily_habit_id,
    };
    
    const validationResult = dailyHabitLogSchema.safeParse(normalizedBody);

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

    const data = validationResult.data;
    const log = await logHabit(
      data.dailyHabitId,
      auth.clientId,
      data.date,
      data.completed,
      data.value
    );

    return NextResponse.json({
      success: true,
      data: log,
    });
  } catch (error) {
    console.error("Error logging habit:", error);
    const statusCode = error instanceof Error && error.message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      {
        success: false,
        error: "Failed to log habit",
      },
      { status: statusCode }
    );
  }
}