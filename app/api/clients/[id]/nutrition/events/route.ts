import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getClientById } from "@/services/client-service";
import { getNutritionEventsForDateRange } from "@/services/nutrition-event-service";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
// The coach calendar grid spans at most a 6-week month view (42 days); allow a
// generous cap so future range reads (e.g. a multi-month prefetch) stay bounded.
const MAX_RANGE_DAYS = 62;

/**
 * GET: Ranged read of a client's nutrition_events for the coach calendar.
 * Thin wrap of getNutritionEventsForDateRange.
 * Query params: startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (inclusive).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const startDate = request.nextUrl.searchParams.get("startDate");
    const endDate = request.nextUrl.searchParams.get("endDate");

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: "startDate and endDate are required" },
        { status: 400 }
      );
    }
    if (!DATE_FORMAT.test(startDate) || !DATE_FORMAT.test(endDate)) {
      return NextResponse.json(
        { success: false, error: "Invalid date format, expected YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (endDate < startDate) {
      return NextResponse.json(
        { success: false, error: "endDate must be on or after startDate" },
        { status: 400 }
      );
    }
    const spanDays =
      (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
    if (spanDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { success: false, error: `Range too large (max ${MAX_RANGE_DAYS} days)` },
        { status: 400 }
      );
    }

    const events = await getNutritionEventsForDateRange(clientId, startDate, endDate);

    return NextResponse.json({ success: true, events }, { status: 200 });
  } catch (error) {
    console.error(
      "Error fetching nutrition events:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch nutrition events" },
      { status: 500 }
    );
  }
}
