import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { getDailyLogs } from "@/services/daily-logs-service";
import { getClientById } from "@/services/client-service";
import { getTodayDateString, getDateDaysAgo } from "@/lib/date-helpers";

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
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const coachId = await getAuthenticatedCoachId();

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
    
    // Default to last 30 days if not provided
    const endDate = searchParams.get("endDate") || getTodayDateString();
    const startDate = searchParams.get("startDate") || getDateDaysAgo(30);

    const logs = await getDailyLogs(clientId, startDate, endDate);

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Error fetching client daily logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch client daily logs",
      },
      { status: 500 }
    );
  }
}