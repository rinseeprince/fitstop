import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { getHabitStats } from "@/services/daily-habits-service";
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
    const habitId = searchParams.get("habitId");
    const daysParam = searchParams.get("days");

    if (!habitId) {
      return NextResponse.json(
        { success: false, error: "habitId parameter is required" },
        { status: 400 }
      );
    }

    const days = daysParam ? parseInt(daysParam, 10) : 30;
    
    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { success: false, error: "days parameter must be between 1 and 365" },
        { status: 400 }
      );
    }

    const stats = await getHabitStats(clientId, habitId, days);

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching habit stats:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch habit stats",
      },
      { status: 500 }
    );
  }
}