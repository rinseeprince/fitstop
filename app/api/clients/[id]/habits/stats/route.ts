import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { getHabitStats, getAllHabitStats } from "@/services/daily-habits-service";
import { getClientById } from "@/services/client-service";
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
    const habitIds = searchParams.get("habitIds");
    const daysParam = searchParams.get("days");

    const days = daysParam ? parseInt(daysParam, 10) : 30;

    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { success: false, error: "days parameter must be between 1 and 365" },
        { status: 400 }
      );
    }

    // Coach-local window end: this is the coach's analytics view.
    const coachToday = await getCoachTodayString(coachId);

    // Batch mode: return stats for all requested habits in one query
    if (habitIds) {
      const ids = habitIds.split(",").filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json(
          { success: false, error: "habitIds must contain at least one ID" },
          { status: 400 }
        );
      }
      const stats = await getAllHabitStats(clientId, ids, days, coachToday);
      return NextResponse.json({ success: true, data: stats });
    }

    // Single habit mode (backward compatible)
    if (!habitId) {
      return NextResponse.json(
        { success: false, error: "habitId or habitIds parameter is required" },
        { status: 400 }
      );
    }

    const stats = await getHabitStats(clientId, habitId, days, coachToday);

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching habit stats:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch habit stats",
      },
      { status: 500 }
    );
  }
}
