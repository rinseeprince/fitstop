import { supabaseAdmin } from "./supabase-admin";
import type { TrainingHistoryRow } from "@/types/history";
import { getTrainingWeekStart, getTodayDateString } from "@/lib/date-helpers";

type TrainingData = {
  trainingSessionName?: string;
  trainingSessionId?: string;
  isAlternativeSession?: boolean;
};

const DAY_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Derive a date from week_start_date + day_of_week offset.
 * Computes offset dynamically based on whatever day weekStart falls on.
 * Used only for orphaned completions as a fallback.
 */
function deriveDateFromWeekDay(weekStart: string, dayOfWeek: string | null): string {
  if (!dayOfWeek) return weekStart;
  const weekStartDate = new Date(weekStart + "T00:00:00Z");
  const weekStartDayNum = weekStartDate.getUTCDay();
  const targetDayNum = DAY_NUM[dayOfWeek.toLowerCase()] ?? weekStartDayNum;
  let offset = targetDayNum - weekStartDayNum;
  if (offset < 0) offset += 7;
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() + offset);
  return weekStartDate.toISOString().split("T")[0];
}

/**
 * Fetches training history combining daily_logs (primary) with
 * session_logs (enrichment + orphaned fallback).
 *
 * Uses supabaseAdmin: coach querying client data (RLS exception 3)
 */
export async function getTrainingHistory(
  clientId: string,
  options: { limit: number; offset: number },
  checkInDay?: string | null
): Promise<{ rows: TrainingHistoryRow[]; total: number; trainingWeekStart: string }> {
  const { limit, offset } = options;

  // Query A: Primary source - training_logs where trained = true
  // Uses daily_logs_full view to also get notes from spine
  const { data: dailyLogs, error: logsError } = await supabaseAdmin
    .from("daily_logs_full" as never)
    .select("date, training_data, training_session_id, notes")
    .eq("client_id" as never, clientId as never)
    .eq("trained" as never, true as never)
    .not("training_data" as never, "is", null)
    .order("date" as never, { ascending: false }) as unknown as {
      data: Array<{ date: string; training_data: unknown; training_session_id: string | null; notes: string | null }> | null;
      error: { message: string } | null;
    };

  if (logsError) {
    throw new Error(`Failed to fetch training logs: ${logsError.message}`);
  }

  // Query B: All completions for this client
  const { data: completions, error: compError } = await supabaseAdmin
    .from("session_logs")
    .select("training_session_id, week_start_date, completion_quality, notes")
    .eq("client_id", clientId);

  if (compError) {
    throw new Error(`Failed to fetch session completions: ${compError.message}`);
  }

  // Build completion lookup: key = "sessionId_weekStart"
  const completionMap = new Map<string, { completion_quality: string | null; notes: string | null }>();
  for (const c of completions || []) {
    const key = `${c.training_session_id}_${c.week_start_date}`;
    completionMap.set(key, {
      completion_quality: c.completion_quality,
      notes: c.notes,
    });
  }

  // Build primary rows from daily_logs, tracking matched completions
  const matchedKeys = new Set<string>();
  const primaryRows: TrainingHistoryRow[] = [];
  // Lookup for dedup: "sessionId_date" -> index in primaryRows
  const primaryRowLookup = new Map<string, number>();

  for (const log of dailyLogs || []) {
    const td = log.training_data as TrainingData | null;
    const sessionId = td?.trainingSessionId || null;
    const sessionName = td?.trainingSessionName || "General Training";
    const isAlt = td?.isAlternativeSession ?? false;

    let completionQuality: TrainingHistoryRow["completion_quality"] = null;

    if (sessionId) {
      const weekStart = getTrainingWeekStart(log.date, checkInDay);
      const key = `${sessionId}_${weekStart}`;
      const match = completionMap.get(key);
      if (match) {
        completionQuality = (match.completion_quality as TrainingHistoryRow["completion_quality"]) ?? null;
        matchedKeys.add(key);
      }
    }

    primaryRows.push({
      date: log.date,
      session_name: sessionName,
      is_alternative: isAlt,
      completion_quality: completionQuality,
      notes: log.notes || null,
    });

    if (sessionId) {
      primaryRowLookup.set(`${sessionId}_${log.date}`, primaryRows.length - 1);
    }
  }

  // Find orphaned completions (no matching daily_log entry)
  const orphanedCompletions = (completions || []).filter((c) => {
    const key = `${c.training_session_id}_${c.week_start_date}`;
    return !matchedKeys.has(key);
  });

  const orphanedRows: TrainingHistoryRow[] = [];

  if (orphanedCompletions.length > 0) {
    // Query C: Get training session details for orphaned completions
    const orphanedSessionIds = [...new Set(orphanedCompletions.map((c) => c.training_session_id).filter((id): id is string => id != null))];
    const { data: sessions, error: sessError } = await supabaseAdmin
      .from("training_sessions")
      .select("id, name, day_of_week")
      .in("id", orphanedSessionIds)
      .eq("is_active", true);

    if (sessError) {
      throw new Error(`Failed to fetch training sessions: ${sessError.message}`);
    }

    const sessionMap = new Map<string, { name: string; day_of_week: string | null }>();
    for (const s of sessions || []) {
      sessionMap.set(s.id, { name: s.name, day_of_week: s.day_of_week });
    }

    // Dedup: if an orphaned completion matches a primary row by sessionId+date,
    // merge the completion data into the primary row instead of creating a duplicate.
    // This handles cases where check-in day changed after session_logs were written.
    for (const c of orphanedCompletions) {
      const session = c.training_session_id ? sessionMap.get(c.training_session_id) : undefined;
      const derivedDate = deriveDateFromWeekDay(c.week_start_date, session?.day_of_week ?? null);
      const quality = (c.completion_quality as TrainingHistoryRow["completion_quality"]) ?? null;

      const primaryIdx = c.training_session_id
        ? primaryRowLookup.get(`${c.training_session_id}_${derivedDate}`)
        : undefined;

      if (primaryIdx !== undefined) {
        // Merge completion data into the existing primary row
        if (quality) primaryRows[primaryIdx].completion_quality = quality;
        if (c.notes) primaryRows[primaryIdx].notes = c.notes;
      } else {
        orphanedRows.push({
          date: derivedDate,
          session_name: session?.name || "Unknown Session",
          is_alternative: false,
          completion_quality: quality,
          notes: c.notes || null,
        });
      }
    }
  }

  // Combine, sort by date descending, paginate
  const allRows = [...primaryRows, ...orphanedRows].sort(
    (a, b) => b.date.localeCompare(a.date)
  );

  const trainingWeekStart = getTrainingWeekStart(getTodayDateString(), checkInDay);

  return {
    rows: allRows.slice(offset, offset + limit),
    total: allRows.length,
    trainingWeekStart,
  };
}
