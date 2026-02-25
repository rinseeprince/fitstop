import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getTodayLog } from "@/services/daily-logs-service";
import { validateDateParameter } from "@/lib/validation-helpers";

export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get date from query params
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    // Validate date if provided
    const dateValidation = validateDateParameter(date);
    if (dateValidation) return dateValidation;

    const log = await getTodayLog(clientId, date || undefined);

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
        error: error instanceof Error ? error.message : "Failed to fetch today's log",
      },
      { status: 500 }
    );
  }
}