import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { getActivitiesRange, getActivities } from "@/services/daily-activities-service";
import { getClientById } from "@/services/client-service";

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
    const date = searchParams.get("date");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let activities: any[];

    if (date) {
      activities = await getActivities(clientId, date);
    } else if (startDate && endDate) {
      activities = await getActivitiesRange(clientId, startDate, endDate);
    } else {
      const defaultEndDate = new Date().toISOString().split('T')[0];
      const defaultStartDate = new Date();
      defaultStartDate.setDate(defaultStartDate.getDate() - 30);
      activities = await getActivitiesRange(
        clientId,
        defaultStartDate.toISOString().split('T')[0],
        defaultEndDate
      );
    }

    return NextResponse.json({
      success: true,
      data: activities,
    });
  } catch (error) {
    console.error("Error fetching client activities:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch client activities",
      },
      { status: 500 }
    );
  }
}