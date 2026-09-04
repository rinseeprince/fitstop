import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { dailyHabitLogSchema } from "@/lib/validations/daily-habit";
import { logHabit } from "@/services/daily-habits-service";
import { assertCanEdit } from "@/services/daily-log-permissions-service";
import { DayLockedError } from "@/lib/daily-log-permissions";

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

    // The shared day rule. Habits lock with their DAY like every other resource:
    // the per-habit narrowing went with the logged-day rule it served, since a
    // habit's own log state no longer decides anything.
    await assertCanEdit({
      clientId: auth.clientId,
      date: data.date,
      resourceType: "habit",
    });

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
    if (error instanceof DayLockedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
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