import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getTodayLog } from "@/services/daily-logs-service";
import { getTodayDateString, getDateDaysAgo } from "@/lib/date-helpers";

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
    if (date) {
      const today = getTodayDateString();
      const thirtyDaysAgo = getDateDaysAgo(30);
      
      // Check if date is in the future
      if (date > today) {
        return NextResponse.json(
          { success: false, error: "Cannot fetch logs for future dates" },
          { status: 400 }
        );
      }
      
      // Check if date is too far in the past
      if (date < thirtyDaysAgo) {
        return NextResponse.json(
          { success: false, error: "Cannot fetch logs older than 30 days" },
          { status: 400 }
        );
      }
    }

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