import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
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
    session_log_id: day.sessionLogId ?? null,
  };
}

/**
 * Earliest date the client has any training activity — the earliest of their
 * first training_event and first session_log. Used to bound the history range
 * for clients with no active phase (roadmaps are opt-in, so no-phase is a
 * normal state). Returns null when the client has no events and no logs.
 */
async function getEarliestActivityDate(clientId: string): Promise<string | null> {
  const [eventRes, logRes] = await Promise.all([
    supabaseAdmin
      .from("training_events")
      .select("date")
      .eq("client_id", clientId)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("session_logs")
      .select("completed_at")
      .eq("client_id", clientId)
      .order("completed_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const candidates: string[] = [];
  if (eventRes.data?.date) candidates.push(eventRes.data.date.substring(0, 10));
  if (logRes.data?.completed_at) candidates.push(logRes.data.completed_at.substring(0, 10));
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

    // Determine the start of the history range. With an active phase, bound by
    // the phase start (unchanged behaviour). Otherwise — roadmaps are opt-in, so
    // no-phase is a normal state — derive the start from the client's earliest
    // training_event / session_log. Either way the schedule is built from events
    // + session_logs (real calendar dates / completed_at), never the legacy
    // daily_logs + week_start_date derivation.
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: phaseRow } = await supabaseAdmin
      .from("phases")
      .select("start_date")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();

    const phaseStartDate = (phaseRow?.start_date as string | null) ?? null;
    const rangeStart = phaseStartDate ?? (await getEarliestActivityDate(clientId));

    // No phase and no activity at all → nothing to show.
    if (!rangeStart) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 200 });
    }

    const today = getTodayDateString();
    const dates = generateDateRange(rangeStart, today);
    const total = dates.length;

    // Fetch training events and session_logs for the full range
    const [events, { data: sessionLogs }] = await Promise.all([
      getEventsForDateRange(clientId, rangeStart, today),
      supabaseAdmin
        .from("session_logs")
        .select("id, training_session_id, completed_at, completion_quality, notes, prescribed_session_snapshot")
        .eq("client_id", clientId)
        .gte("completed_at", rangeStart)
        .lte("completed_at", today),
    ]);

    // Build lookup map of ALL session_logs by id (for swap detection)
    const sessionLogMap = new Map(
      (sessionLogs ?? []).map((log) => [log.id, log])
    );

    // Find session_logs not linked to any event
    const linkedLogIds = new Set(
      events.filter((e) => e.sessionLogId).map((e) => e.sessionLogId)
    );
    const unlinkedLogs = (sessionLogs ?? []).filter(
      (log) => !linkedLogIds.has(log.id)
    );

    // Resolve performed session names so a swap shows what the client actually
    // did (the log's training_session_id), not the prescribed snapshot.
    const performedSessionIds = [
      ...new Set(
        (sessionLogs ?? [])
          .map((l) => l.training_session_id)
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
      unlinkedLogs,
      sessionLogMap,
      performedSessionNames
    );

    // Reverse for newest-first, then paginate
    const reversed = schedule.reverse();
    const paged = reversed.slice(offset, offset + limit);
    const rows = paged.map(mapScheduleDayToRow);

    return NextResponse.json({ rows, total }, { status: 200 });
  } catch (error) {
    console.error("Error fetching training history:", error);
    return NextResponse.json(
      { error: "Failed to fetch training history" },
      { status: 500 }
    );
  }
}
