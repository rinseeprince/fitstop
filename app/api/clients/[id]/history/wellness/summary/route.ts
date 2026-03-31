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

    const { searchParams } = new URL(request.url);
    const ALLOWED_DAYS = [7, 14, 28] as const;
    const rawDays = Number(searchParams.get("days") || 7);
    const days = ALLOWED_DAYS.includes(rawDays as 7 | 14 | 28) ? rawDays : 7;

    let sinceDateStr: string;
    let daysInWindow: number;

    if (days === 7) {
      // Use training week boundaries for the default 7-day view
      // Fetch client's check-in day and start date
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

      const effectiveStart = clientStartDate && clientStartDate > weekStart
        ? clientStartDate
        : weekStart;

      const startMs = new Date(effectiveStart + "T00:00:00").getTime();
      const endMs = new Date(weekEnd + "T00:00:00").getTime();
      daysInWindow = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
      sinceDateStr = effectiveStart;
    } else {
      // For 14/28-day lookbacks, use calendar days
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - (days - 1));
      sinceDateStr = sinceDate.toISOString().split("T")[0];
      daysInWindow = days;
    }

    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    // Direct query on wellness_logs
    const { data, error } = await supabaseAdmin
      .from("wellness_logs" as never)
      .select("mood, energy, sleep, stress")
      .eq("client_id" as never, clientId as never)
      .or("mood.not.is.null,energy.not.is.null,sleep.not.is.null,stress.not.is.null" as never)
      .gte("date" as never, sinceDateStr as never) as unknown as { data: Array<{ mood: number | null; energy: number | null; sleep: number | null; stress: number | null }> | null; error: { message: string } | null };

    if (error) {
      console.error("Error fetching wellness summary:", error);
      return NextResponse.json(
        { error: "Failed to fetch wellness summary" },
        { status: 500 }
      );
    }

    const rows = data || [];

    // Average per-metric over only the rows where that metric is non-null
    function avgMetric(field: "mood" | "energy" | "sleep" | "stress"): number | null {
      const values = rows.filter((r) => r[field] != null).map((r) => r[field] as number);
      if (values.length === 0) return null;
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return Math.round(avg * 10) / 10;
    }

    const summary = {
      avg_mood: avgMetric("mood"),
      avg_energy: avgMetric("energy"),
      avg_sleep: avgMetric("sleep"),
      avg_stress: avgMetric("stress"),
      days_logged: rows.length,
      days_in_window: daysInWindow,
    };

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Error fetching wellness summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch wellness summary" },
      { status: 500 }
    );
  }
}
