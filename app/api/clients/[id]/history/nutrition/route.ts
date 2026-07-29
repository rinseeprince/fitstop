import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { fetchNutritionDataForPeriod, fetchTrainingDataForPeriod } from "@/services/schedule-data-service";
import { buildNutritionSummary } from "@/utils/nutrition-period-summary";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getCoachTodayString } from "@/services/today-service";
import type { NutritionHistoryRow } from "@/types/history";
import type { NutritionDay } from "@/types/schedule";
import { getNutritionEventsForDateRange } from "@/services/nutrition-event-service";

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function mapNutritionDayToRow(day: NutritionDay): NutritionHistoryRow {
  const isLogged = day.status !== "not_logged";
  const surplus = isLogged && day.actualCalories != null && day.targetCalories != null
    ? day.actualCalories - day.targetCalories
    : null;

  return {
    date: day.date,
    calories_consumed: day.actualCalories,
    target_calories: day.targetCalories,
    protein_g: day.actualProteinG,
    target_protein_g: day.targetProteinG,
    carbs_g: day.actualCarbsG,
    target_carbs_g: day.targetCarbsG,
    fat_g: day.actualFatG,
    target_fat_g: day.targetFatG,
    calorie_surplus_deficit: surplus,
    nutrition_adherence: day.status === "not_logged" ? null : day.status,
    is_logged: isLogged,
  };
}

/**
 * Earliest date the client has any nutrition activity — the earliest of their
 * first logged nutrition_log and first nutrition_event. Bounds the history
 * range. Returns null when the client has no logs and no events.
 */
async function getEarliestNutritionActivityDate(clientId: string): Promise<string | null> {
  const [logRes, eventRes] = await Promise.all([
    supabaseAdmin
      .from("nutrition_logs")
      .select("date")
      .eq("client_id", clientId)
      .not("calories_consumed", "is", null)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("nutrition_events")
      .select("date")
      .eq("client_id", clientId)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const candidates: string[] = [];
  if (logRes.data?.date) candidates.push(logRes.data.date.substring(0, 10));
  if (eventRes.data?.date) candidates.push(eventRes.data.date.substring(0, 10));
  if (candidates.length === 0) return null;
  return candidates.sort()[0];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);
    if (!pagination.valid) {
      return NextResponse.json(
        { success: false, error: pagination.error },
        { status: 400 }
      );
    }

    const { limit, offset } = pagination;

    // The history range starts at the client's earliest nutrition_log /
    // nutrition_event, giving an event-based day-by-day summary (real `date`
    // throughout) instead of a logged-days-only nutrition_logs read.
    const rangeStart = await getEarliestNutritionActivityDate(clientId);

    // No activity at all → nothing to show.
    if (!rangeStart) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 200 });
    }

    // Coach-local today bounds the history range (coach's view).
    const today = await getCoachTodayString(auth.coachId);
    const dates = generateDateRange(rangeStart, today);
    const total = dates.length;

    const [nutritionData, trainingData, nutritionEvents] = await Promise.all([
      fetchNutritionDataForPeriod(clientId, rangeStart, today),
      fetchTrainingDataForPeriod(clientId, rangeStart, today),
      getNutritionEventsForDateRange(clientId, rangeStart, today),
    ]);
    const summary = buildNutritionSummary(dates, nutritionData.plans, nutritionData.nutritionLogs, trainingData.plans, nutritionEvents);

    // Reverse for newest-first, then paginate
    const reversed = summary.reverse();
    const paged = reversed.slice(offset, offset + limit);
    const rows = paged.map(mapNutritionDayToRow);

    return NextResponse.json({ rows, total }, { status: 200 });
  } catch (error) {
    console.error("Error fetching nutrition history:", error);
    return NextResponse.json(
      { error: "Failed to fetch nutrition history" },
      { status: 500 }
    );
  }
}
