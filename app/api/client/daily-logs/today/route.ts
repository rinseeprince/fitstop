import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getTodayLog } from "@/services/daily-logs-service";
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

    const log = await getTodayLog(auth.clientId, date || undefined);

    return NextResponse.json(
      {
        success: true,
        data: log,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error("Error fetching today's daily log:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch today's log",
      },
      { status: 500 }
    );
  }
}