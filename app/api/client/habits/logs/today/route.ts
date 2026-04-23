import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getTodayHabitLogs } from "@/services/daily-habits-service";
import { validateDateParameter } from "@/lib/validation-helpers";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Get date from query params
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    // Validate date if provided
    const dateValidation = validateDateParameter(date);
    if (dateValidation) return dateValidation;

    const logs = await getTodayHabitLogs(auth.clientId, date || undefined);

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Error fetching today's habit logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch today's habit logs",
      },
      { status: 500 }
    );
  }
}