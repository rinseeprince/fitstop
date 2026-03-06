import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyHabitLogSchema } from "@/lib/validations/daily-habit";
import { logHabit } from "@/services/daily-habits-service";

export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
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

    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      dailyHabitId: rawBody.dailyHabitId ?? rawBody.daily_habit_id,
    };
    
    const validationResult = dailyHabitLogSchema.safeParse(normalizedBody);

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

    const data = validationResult.data;
    const log = await logHabit(
      data.dailyHabitId,
      clientId,
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
    return NextResponse.json(
      {
        success: false,
        error: "Failed to log habit",
      },
      { status: 500 }
    );
  }
}