import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { fetchNutritionDataForPeriod, fetchTrainingDataForPeriod } from "@/services/schedule-data-service";
import { buildNutritionSummary } from "@/utils/nutrition-period-summary";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getTodayDateString } from "@/lib/date-helpers";
import type { NutritionHistoryRow } from "@/types/history";
import type { NutritionDay } from "@/types/schedule";
import { getNutritionEventsForDateRange } from "@/services/nutrition-event-service";

const NUTRITION_COLUMNS = `
  date,
  calories_consumed,
  target_calories,
  protein_g,
  target_protein_g,
  carbs_g,
  target_carbs_g,
  fat_g,
  target_fat_g,
  calorie_surplus_deficit,
  nutrition_adherence
`.replace(/\s+/g, " ").trim();

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
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

    // Check for active phase
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: phase } = await supabaseAdmin
      .from("phases")
      .select("start_date")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();

    const phaseStartDate = phase?.start_date as string | null;

    if (phaseStartDate) {
      const today = getTodayDateString();
      const dates = generateDateRange(phaseStartDate, today);
      const total = dates.length;

      const [nutritionData, trainingData, nutritionEvents] = await Promise.all([
        fetchNutritionDataForPeriod(clientId, phaseStartDate, today),
        fetchTrainingDataForPeriod(clientId, phaseStartDate, today),
        getNutritionEventsForDateRange(clientId, phaseStartDate, today),
      ]);
      const summary = buildNutritionSummary(dates, nutritionData.plans, nutritionData.nutritionLogs, trainingData.plans, nutritionEvents);

      // Reverse for newest-first, then paginate
      const reversed = summary.reverse();
      const paged = reversed.slice(offset, offset + limit);
      const rows = paged.map(mapNutritionDayToRow);

      return NextResponse.json({ rows, total }, { status: 200 });
    }

    // Fallback: no active phase, use existing logged-only behavior
    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    const { data, error, count } = await supabaseAdmin
      .from("nutrition_logs" as never)
      .select(NUTRITION_COLUMNS, { count: "exact" })
      .eq("client_id" as never, clientId as never)
      .not("calories_consumed" as never, "is", null)
      .order("date" as never, { ascending: false })
      .range(offset, offset + limit - 1) as unknown as { data: unknown[] | null; error: { message: string } | null; count: number | null };

    if (error) {
      console.error("Error fetching nutrition history:", error);
      return NextResponse.json(
        { error: "Failed to fetch nutrition history" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { rows: data || [], total: count || 0 },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching nutrition history:", error);
    return NextResponse.json(
      { error: "Failed to fetch nutrition history" },
      { status: 500 }
    );
  }
}
