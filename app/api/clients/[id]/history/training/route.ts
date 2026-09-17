import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getEventsForDateRange } from "@/services/training-event-service";
import { mapEventsToScheduleDays } from "@/utils/training-event-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getCoachTodayString } from "@/services/today-service";
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
  // Logged is the attendance word; the chip beside it reads the quality.
  const isLogged = day.status === "completed";
  return {
    date: day.date,
    session_name: day.loggedSessionName ?? day.plannedSessionName ?? "",
    is_alternative: day.isAlternative,
    completion_quality: day.completionQuality,
    notes: day.notes,
    is_logged: isLogged,
    session_log_id: day.sessionLogId ?? null,
  };
}

/**
 * The client's first day on the calendar — the table is one row per workout on
 * a date, so its range starts at their earliest training_event. Null when they
 * have none.
 */
async function getEarliestEventDate(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("training_events")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.date ? data.date.substring(0, 10) : null;
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

    // The history range starts at the client's earliest training_event. The
    // schedule is built from the calendar's own workouts — each with its log
    // embedded — never the legacy daily_logs + week_start_date derivation.
    const rangeStart = await getEarliestEventDate(clientId);

    // Nothing on the calendar → nothing to show.
    if (!rangeStart) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 200 });
    }

    // Coach-local today bounds the history range (coach's view) and is the day
    // a still-scheduled workout is judged missed against.
    const today = await getCoachTodayString(auth.coachId);
    const dates = generateDateRange(rangeStart, today);

    const events = await getEventsForDateRange(clientId, rangeStart, today);

    // Resolve performed session names so a swap shows what the client actually
    // did (the log's own training_session_id), not the prescribed snapshot.
    const performedSessionIds = [
      ...new Set(
        events
          .map((event) => event.log?.performedSessionId ?? null)
          .filter((id): id is string => id !== null)
      ),
    ];
    const performedSessionNames = new Map<string, string>();
    if (performedSessionIds.length > 0) {
      const { data: sessionRows } = await supabaseAdmin
        .from("training_sessions")
        .select("id, name")
        .in("id", performedSessionIds);
      for (const row of sessionRows ?? []) {
        performedSessionNames.set(row.id, row.name);
      }
    }

    const schedule = mapEventsToScheduleDays(
      dates,
      events,
      today,
      performedSessionNames
    );

    // One row per workout (a rest day is one row). Newest day first, a day's
    // workouts still in the day's order — the sort is stable — then paginate.
    const newestFirst = [...schedule].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const rows = newestFirst.slice(offset, offset + limit).map(mapScheduleDayToRow);

    return NextResponse.json({ rows, total: newestFirst.length }, { status: 200 });
  } catch (error) {
    console.error("Error fetching training history:", error);
    return NextResponse.json(
      { error: "Failed to fetch training history" },
      { status: 500 }
    );
  }
}
