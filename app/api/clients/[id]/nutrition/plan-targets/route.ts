import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getClientById } from "@/services/client-service";
import { getNutritionTargetsForDateRange } from "@/services/nutrition-days-service";

const MAX_DATES = 31;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET: the computed target for specific dates, as the client is shown it —
 * the day reader's target through the client's display switches, the same
 * number every other reader judges a day against. Used by the check-in review
 * for every day of a check-in's period. A date no version covers answers
 * zeros. Query param: dates=YYYY-MM-DD,YYYY-MM-DD,...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const datesParam = request.nextUrl.searchParams.get("dates");

    if (!datesParam) {
      return NextResponse.json({ error: "dates parameter required" }, { status: 400 });
    }

    const dates = datesParam.split(",").filter(Boolean);

    if (dates.length > MAX_DATES) {
      return NextResponse.json({ error: `Too many dates (max ${MAX_DATES})` }, { status: 400 });
    }

    if (!dates.every((d) => DATE_FORMAT.test(d))) {
      return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
    }

    const sortedDates = [...dates].sort();
    const minDate = sortedDates[0];
    const maxDate = sortedDates[sortedDates.length - 1];

    // One batched lookup over the span; the number of dates decides nothing.
    const byDate = await getNutritionTargetsForDateRange(clientId, minDate, maxDate);

    const targets = dates.map((date) => {
      const target = byDate.get(date);
      if (target) {
        return {
          date,
          calories: target.calories,
          proteinG: target.proteinG,
          carbsG: target.carbsG,
          fatG: target.fatG,
          isTrainingDay: target.isTrainingDay,
        };
      }
      return { date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isTrainingDay: false };
    });

    return NextResponse.json({ targets }, { status: 200 });
  } catch (error) {
    console.error("Error fetching plan targets:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { error: "Failed to fetch plan targets" },
      { status: 500 }
    );
  }
}
