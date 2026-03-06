import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { calculateStreaks } from "@/services/daily-logs-service";

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

    const streaks = await calculateStreaks(clientId);

    return NextResponse.json(
      {
        success: true,
        data: streaks,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error("Error calculating streaks:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate streaks",
      },
      { status: 500 }
    );
  }
}