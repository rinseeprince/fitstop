import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getClientById } from "@/services/client-service";
import { getPlanTargetForDate } from "@/services/daily-context-service";
import { getNutritionEventsForDateRange } from "@/services/nutrition-event-service";
import { getTotalCalories } from "@/utils/nutrition-event-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";

const MAX_DATES = 31;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET: Retrieve plan-based daily targets for specific dates.
 * Used by check-in review to compute full-week targets for unlogged days.
 * Query param: dates=YYYY-MM-DD,YYYY-MM-DD,...
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

    // Batch fetch: events + activity burn flag in parallel
    const [events, { data: clientRow }] = await Promise.all([
      getNutritionEventsForDateRange(clientId, minDate, maxDate),
      supabaseAdmin.from("clients").select("include_activity_burn").eq("id", clientId).single(),
    ]);
    const includeActivityBurn = clientRow?.include_activity_burn !== false;

    const eventsByDate = new Map(events.map((e) => [e.date.split("T")[0], e]));

    const targets = await Promise.all(
      dates.map(async (date) => {
        const event = eventsByDate.get(date);
        if (event) {
          return {
            date,
            calories: getTotalCalories(event, includeActivityBurn),
            proteinG: event.proteinG,
            carbsG: event.carbG,
            fatG: event.fatG,
            isTrainingDay: event.isTrainingDay,
          };
        }
        // TODO NE-3-cleanup: remove template fallback once event coverage guaranteed
        const target = await getPlanTargetForDate(clientId, date, includeActivityBurn);
        return target
          ? { date, ...target }
          : { date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isTrainingDay: false };
      })
    );

    return NextResponse.json({ targets }, { status: 200 });
  } catch (error) {
    console.error("Error fetching plan targets:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { error: "Failed to fetch plan targets" },
      { status: 500 }
    );
  }
}
