import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getTrainingWeekStart, getTrainingWeekEnd, getTodayDateString } from "@/lib/date-helpers";

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

    // Fetch client's check-in day and start date for correct week boundaries
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("expected_check_in_day, start_date")
      .eq("id", clientId)
      .single();

    const checkInDay = clientRow?.expected_check_in_day ?? null;
    const clientStartDate: string | null = clientRow?.start_date ?? null;

    const today = getTodayDateString();
    const weekStart = getTrainingWeekStart(today, checkInDay);
    const weekEnd = getTrainingWeekEnd(today, checkInDay);

    // Handle partial first week: if client started after the week start, use their start date
    const effectiveStart = clientStartDate && clientStartDate > weekStart
      ? clientStartDate
      : weekStart;

    const startMs = new Date(effectiveStart + "T00:00:00").getTime();
    const endMs = new Date(weekEnd + "T00:00:00").getTime();
    const daysInWeek = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;

    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    // Direct query on nutrition_logs
    const { data, error } = await supabaseAdmin
      .from("nutrition_logs" as never)
      .select("calories_consumed, protein_g, carbs_g, fat_g")
      .eq("client_id" as never, clientId as never)
      .not("calories_consumed" as never, "is", null)
      .gte("date" as never, effectiveStart as never)
      .lte("date" as never, weekEnd as never) as unknown as { data: Array<{ calories_consumed: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }> | null; error: { message: string } | null };

    if (error) {
      console.error("Error fetching nutrition summary:", error);
      return NextResponse.json(
        { error: "Failed to fetch nutrition summary" },
        { status: 500 }
      );
    }

    const rows = data || [];
    const summary = {
      total_calories: rows.reduce((sum, r) => sum + (r.calories_consumed || 0), 0),
      total_protein: rows.reduce((sum, r) => sum + (r.protein_g || 0), 0),
      total_carbs: rows.reduce((sum, r) => sum + (r.carbs_g || 0), 0),
      total_fat: rows.reduce((sum, r) => sum + (r.fat_g || 0), 0),
      days_logged: rows.length,
      days_in_week: daysInWeek,
    };

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Error fetching nutrition summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch nutrition summary" },
      { status: 500 }
    );
  }
}
