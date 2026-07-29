import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getDailyLogs } from "@/services/daily-logs-service";
import { getClientById } from "@/services/client-service";
import { getDateDaysFrom } from "@/lib/date-helpers";
import { getCoachTodayString } from "@/services/today-service";

async function verifyClientOwnership(
  clientId: string,
  coachId: string
): Promise<boolean> {
  const client = await getClientById(clientId);
  return client !== null && client.coachId === coachId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const coachId = await getAuthenticatedCoachId(request);

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const hasAccess = await verifyClientOwnership(clientId, coachId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Default to the last 30 days ending on the coach-local today (coach view)
    const endDate = searchParams.get("endDate") || (await getCoachTodayString(coachId));
    const startDate = searchParams.get("startDate") || getDateDaysFrom(new Date(endDate + "T00:00:00"), -30);

    const logs = await getDailyLogs(clientId, startDate, endDate);

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Error fetching client daily logs:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch client daily logs",
      },
      { status: 500 }
    );
  }
}