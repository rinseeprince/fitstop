import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getWeeklyLogs } from "@/services/daily-logs-service";
import { getWeekStart, getWeekEnd } from "@/lib/date-helpers";

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

    // Get date from query params (defaults to today for current week)
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    
    // Get the week boundaries for the given date
    const weekStart = date ? getWeekStart(date) : getWeekStart(new Date().toISOString().split('T')[0]);
    const weekEnd = date ? getWeekEnd(date) : getWeekEnd(new Date().toISOString().split('T')[0]);

    const logs = await getWeeklyLogs(clientId, weekStart, weekEnd);

    return NextResponse.json(
      {
        success: true,
        data: logs,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error("Error fetching weekly logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch weekly logs",
      },
      { status: 500 }
    );
  }
}