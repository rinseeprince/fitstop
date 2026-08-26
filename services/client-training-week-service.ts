import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import type {
  ClientTrainingWeek,
  ClientTrainingWeekSession,
  ClientTrainingWeekSessionState,
} from "@/types/client-training-week";

// Explicit columns (CONVENTIONS §8, client read scaling): a client read never
// selects `*`. `session_name`/`session_focus` are the event's own snapshots, so
// no session join is needed for the picker's labels.
const WEEK_COLUMNS = "id, training_session_id, date, session_name, session_focus, status";

function deriveState(status: string, date: string, today: string): ClientTrainingWeekSessionState {
  if (status === "completed" || status === "partial") return "done";
  if (status === "skipped" || status === "missed") return "missed";
  // scheduled
  if (date === today) return "today";
  return date > today ? "upcoming" : "missed";
}

/**
 * The client's training week containing `date` — every training event in the
 * check-in-anchored week, with a `state` derived against the CLIENT's today.
 *
 * This is the set the layout write may touch (moves are bounded to the week a
 * session currently sits in), and it is what the session picker lists, so the
 * client sees exactly the days a pick can land on. ≤7 rows, one indexed read
 * on `idx_training_events_client_date`, plus the check-in day and today.
 */
export async function getClientTrainingWeek(
  clientId: string,
  date: string
): Promise<ClientTrainingWeek> {
  const [clientRes, today] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("expected_check_in_day")
      .eq("id", clientId)
      .maybeSingle(),
    getClientTodayString(clientId),
  ]);
  if (clientRes.error) {
    throw new Error(`Failed to load client for training week: ${clientRes.error.message}`);
  }

  const checkInDay = clientRes.data?.expected_check_in_day ?? null;
  const weekStart = getTrainingWeekStart(date, checkInDay);
  const weekEnd = getTrainingWeekEnd(date, checkInDay);

  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select(WEEK_COLUMNS)
    .eq("client_id", clientId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to load training week: ${error.message}`);
  }

  const sessions: ClientTrainingWeekSession[] = (data ?? []).map((row) => ({
    eventId: row.id,
    sessionId: row.training_session_id,
    name: row.session_name,
    focus: row.session_focus,
    date: row.date,
    state: deriveState(row.status, row.date, today),
    isScheduled: row.status === "scheduled",
  }));

  return { weekStart, weekEnd, today, sessions };
}
