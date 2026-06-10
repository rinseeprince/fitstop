import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { getClientById } from "@/services/client-service";
import { getWeeklyHabitsData } from "@/services/habits-weekly-service";
import { getTrainingWeekStart } from "@/lib/date-helpers";
import { getCoachTodayString } from "@/services/today-service";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DATE = "2020-01-01";

async function verifyClientOwnership(
  clientId: string,
  coachId: string
) {
  const client = await getClientById(clientId);
  if (!client || client.coachId !== coachId) return null;
  return client;
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

    const client = await verifyClientOwnership(clientId, coachId);
    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const weekStartParam = searchParams.get("weekStart");

    if (!weekStartParam) {
      return NextResponse.json(
        { success: false, error: "weekStart parameter is required" },
        { status: 400 }
      );
    }

    if (!DATE_REGEX.test(weekStartParam)) {
      return NextResponse.json(
        { success: false, error: "Invalid date format. Expected YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const parsed = new Date(weekStartParam + "T00:00:00");
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { success: false, error: "Invalid date" },
        { status: 400 }
      );
    }

    // Range check: not before 2020, not more than 7 days in the future
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 7);
    if (weekStartParam < MIN_DATE || parsed > maxDate) {
      return NextResponse.json(
        { success: false, error: "Date out of range" },
        { status: 400 }
      );
    }

    // Snap to coaching week start
    const weekStart = getTrainingWeekStart(weekStartParam, client.expectedCheckInDay);

    const data = await getWeeklyHabitsData(
      clientId,
      weekStart,
      client.expectedCheckInDay,
      // Coach-local today (this is the coach's weekly view).
      await getCoachTodayString(coachId)
    );

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching weekly habits:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch weekly habits" },
      { status: 500 }
    );
  }
}
