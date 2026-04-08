import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getTrainingHistory } from "@/services/training-history-service";
import { getEventsForDateRange } from "@/services/training-event-service";
import { mapEventsToScheduleDays } from "@/utils/training-event-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getTodayDateString } from "@/lib/date-helpers";
import type { TrainingHistoryRow } from "@/types/history";
import type { ScheduleDay } from "@/types/schedule";

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

function mapScheduleDayToRow(day: ScheduleDay): TrainingHistoryRow {
  const isLogged = !["missed", "rest"].includes(day.status);
  return {
    date: day.date,
    session_name: day.loggedSessionName ?? day.plannedSessionName ?? "",
    is_alternative: day.isAlternative,
    completion_quality: day.completionQuality,
    notes: day.notes,
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

    // Fetch client's check-in day and active phase start date
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const [clientResult, phaseResult] = await Promise.all([
      supabaseAdmin
        .from("clients")
        .select("expected_check_in_day")
        .eq("id", clientId)
        .single(),
      supabaseAdmin
        .from("phases")
        .select("start_date")
        .eq("client_id", clientId)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    const phaseStartDate = phaseResult.data?.start_date as string | null;

    // If client has an active phase, generate full day-by-day schedule
    if (phaseStartDate) {
      const today = getTodayDateString();
      const dates = generateDateRange(phaseStartDate, today);
      const total = dates.length;

      // Fetch training events for the full range
      const events = await getEventsForDateRange(clientId, phaseStartDate, today);
      const schedule = mapEventsToScheduleDays(dates, events);

      // Reverse for newest-first, then paginate
      const reversed = schedule.reverse();
      const paged = reversed.slice(offset, offset + limit);
      const rows = paged.map(mapScheduleDayToRow);

      return NextResponse.json({ rows, total }, { status: 200 });
    }

    // Fallback: no active phase, use existing logged-only behavior
    const result = await getTrainingHistory(
      clientId,
      { limit, offset },
      clientResult.data?.expected_check_in_day
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error fetching training history:", error);
    return NextResponse.json(
      { error: "Failed to fetch training history" },
      { status: 500 }
    );
  }
}
