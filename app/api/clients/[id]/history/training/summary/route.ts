import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getTrainingWeekStart, getTrainingWeekEnd, getTodayDateString } from "@/lib/date-helpers";
import { countEventsInRange } from "@/services/training-event-service";

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

    // Fetch client's check-in day for correct week boundaries
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("expected_check_in_day")
      .eq("id", clientId)
      .single();

    const checkInDay = clientRow?.expected_check_in_day ?? "monday";

    const today = getTodayDateString();
    const weekStart = getTrainingWeekStart(today, checkInDay);
    const weekEnd = getTrainingWeekEnd(today, checkInDay);

    // Query session_logs for this week
    // completed_at is TIMESTAMPTZ, so use time boundaries to include full days
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: weekLogs, error: weekError } = await supabaseAdmin
      .from("session_logs")
      .select("completion_quality")
      .eq("client_id", clientId)
      .gte("completed_at", weekStart + "T00:00:00")
      .lte("completed_at", weekEnd + "T23:59:59");

    if (weekError) {
      console.error("Error fetching training week logs:", weekError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch training summary" },
        { status: 500 }
      );
    }

    const completed = (weekLogs || []).filter(
      (r) => r.completion_quality === "full"
    ).length;

    // Count planned sessions from training events (cap at today — can't miss a future session)
    const effectiveEnd = today < weekEnd ? today : weekEnd;
    const plannedUpToToday = await countEventsInRange(clientId, weekStart, effectiveEnd);
    const totalPlanned = plannedUpToToday;

    const missed = Math.max(0, plannedUpToToday - completed);

    return NextResponse.json(
      { success: true, data: { completed, totalPlanned, plannedUpToToday, missed } },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching training summary:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch training summary" },
      { status: 500 }
    );
  }
}
