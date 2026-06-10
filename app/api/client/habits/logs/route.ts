import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getDateDaysFrom } from "@/lib/date-helpers";
import { getClientTodayString } from "@/services/today-service";
import { getHabitLogs } from "@/services/daily-habits-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);

    // Default to the last 30 days ending on the CLIENT's local today. The web
    // app always passes explicit dates; this default is the RN-contract path.
    const endDate = searchParams.get("endDate") || (await getClientTodayString(auth.clientId));
    const startDate = searchParams.get("startDate") || getDateDaysFrom(new Date(endDate + "T00:00:00"), -30);

    const logs = await getHabitLogs(auth.clientId, startDate, endDate);

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Error fetching habit logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch habit logs",
      },
      { status: 500 }
    );
  }
}