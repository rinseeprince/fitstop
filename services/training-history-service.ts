import { supabaseAdmin } from "./supabase-admin";
import type { TrainingHistoryRow } from "@/types/history";

type TrainingData = {
  trainingSessionName?: string;
  trainingSessionId?: string;
  isAlternativeSession?: boolean;
};

const DAY_OFFSETS: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/**
 * Compute the Monday (week start) for a given date string.
 */
function getWeekStartDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  const day = date.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - diff);
  return monday.toISOString().split("T")[0];
}

/**
 * Derive a date from week_start_date + day_of_week offset.
 * Used only for orphaned completions as a fallback.
 */
function deriveDateFromWeekDay(weekStart: string, dayOfWeek: string | null): string {
  if (!dayOfWeek) return weekStart;
  const offset = DAY_OFFSETS[dayOfWeek.toLowerCase()] ?? 0;
  const date = new Date(weekStart + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().split("T")[0];
}

/**
 * Fetches training history combining daily_logs (primary) with
 * session_logs (enrichment + orphaned fallback).
 *
 * Uses supabaseAdmin: coach querying client data (RLS exception 3)
 */
export async function getTrainingHistory(
  clientId: string,
  options: { limit: number; offset: number }
): Promise<{ rows: TrainingHistoryRow[]; total: number }> {
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

  for (const log of dailyLogs || []) {
    const td = log.training_data as TrainingData | null;
    const sessionId = td?.trainingSessionId || null;
    const sessionName = td?.trainingSessionName || "General Training";
    const isAlt = td?.isAlternativeSession ?? false;

    let completionQuality: TrainingHistoryRow["completion_quality"] = null;

    if (sessionId) {
      const weekStart = getWeekStartDate(log.date);
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
  }

  // Find orphaned completions (no matching daily_log entry)
  const orphanedCompletions = (completions || []).filter((c) => {
    const key = `${c.training_session_id}_${c.week_start_date}`;
    return !matchedKeys.has(key);
  });

  let orphanedRows: TrainingHistoryRow[] = [];

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

    orphanedRows = orphanedCompletions.map((c) => {
      const session = c.training_session_id ? sessionMap.get(c.training_session_id) : undefined;
      return {
        date: deriveDateFromWeekDay(c.week_start_date, session?.day_of_week ?? null),
        session_name: session?.name || "Unknown Session",
        is_alternative: false,
        completion_quality: (c.completion_quality as TrainingHistoryRow["completion_quality"]) ?? null,
        notes: c.notes || null,
      };
    });
  }

  // Combine, sort by date descending, paginate
  const allRows = [...primaryRows, ...orphanedRows].sort(
    (a, b) => b.date.localeCompare(a.date)
  );

  return {
    rows: allRows.slice(offset, offset + limit),
    total: allRows.length,
  };
}
