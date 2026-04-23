import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { calculateStreaks } from "@/services/daily-logs-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const streaks = await calculateStreaks(auth.clientId);

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