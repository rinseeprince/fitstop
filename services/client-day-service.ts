import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionForDate } from "./daily-context-service";
import { getTodayLog } from "./daily-logs-service";
import { getClientHabits, getTodayHabitLogs } from "./daily-habits-service";
import { supabaseAdmin } from "./supabase-admin";
import type { DaySummary } from "@/types/client-day";

/**
 * Sessions logged ON `date` whose matched prescribed event falls on a DIFFERENT
 * date — powers the Session 5.4 "Trained for {weekday} {session}" line. Anchored
 * to the log's completed_at (the day trained), NOT to events of `date` (a rest
 * day has none). Unmatched extras (training_event_id null) are excluded by the
 * not-null filter. completed_at is TIMESTAMPTZ → the house date-range pattern.
 */
async function getTrainedForLinks(
  clientId: string,
  date: string
): Promise<{ date: string; sessionName: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("session_logs")
    .select(
      "prescribed_session_snapshot, training_events!session_logs_training_event_id_fkey(date)"
    )
    .eq("client_id", clientId)
    .not("training_event_id", "is", null)
    .gte("completed_at", `${date}T00:00:00`)
    .lte("completed_at", `${date}T23:59:59`);
  if (error) {
    throw new Error(`Failed to load trained-for links: ${error.message}`);
  }

  const out: { date: string; sessionName: string }[] = [];
  for (const row of data ?? []) {
    // Embedded to-one event; defensively handle object-or-array shape. Cast via
    // unknown — the FK relation only resolves in generated types post-migration.
    const ev = (
      row as unknown as {
        training_events: { date: string } | { date: string }[] | null;
      }
    ).training_events;
    const eventDate = Array.isArray(ev) ? ev[0]?.date : ev?.date;
    // Only when the log was attributed to a DIFFERENT day than it was logged on.
    if (!eventDate || eventDate === date) continue;
    const snapshot = row.prescribed_session_snapshot as Record<string, unknown> | null;
    const sessionName =
      typeof snapshot?.name === "string" ? snapshot.name : "Session";
    out.push({ date: eventDate, sessionName });
  }
  return out;
}

/**
 * Lightweight day summary for the client home screen.
 * Composes existing domain services — does not query tables directly.
 */
export async function getDaySummary(
  clientId: string,
  date: string
): Promise<DaySummary> {
  const [trainingEvents, trainedFor, nutrition, dailyLog, habits, habitLogs] =
    await Promise.all([
      getEventSummariesForDate(clientId, date),
      getTrainedForLinks(clientId, date),
      getNutritionForDate(clientId, date),
      getTodayLog(clientId, date),
      getClientHabits(clientId),
      getTodayHabitLogs(clientId, date),
    ]);

  return {
    training: trainingEvents,
    trainedFor,
    // Log-authoritative: a nutrition_logs row (source "log") means logged, even if the
    // nutrition_event status was never flipped. consumed/target drive the home card numbers.
    nutrition:
      nutrition.source !== null
        ? {
            hasLog: nutrition.source === "log",
            caloriesConsumed: nutrition.consumed?.calories ?? null,
            targetCalories: nutrition.target?.calories ?? null,
            // Coach per-day note (event source only — logged days have no note).
            // Surfaced on the home card since future days aren't openable.
            note: nutrition.target?.note ?? null,
          }
        : null,
    wellness: {
      hasLog:
        dailyLog != null &&
        (dailyLog.mood != null ||
          dailyLog.energy != null ||
          dailyLog.sleep != null ||
          dailyLog.stress != null ||
          dailyLog.soreness != null),
    },
    // Only count habits that had become effective by `date` — mirrors the
    // /client/habits detail page's `effectiveDate <= date` filter so the home card's
    // "X of N" agrees with the toggles the page renders (a habit can't be logged for a
    // date before it existed, so loggedCount is already within this set).
    habits: {
      totalCount: habits.filter((h) => h.effectiveDate <= date).length,
      loggedCount: habitLogs.filter((l) => l.completed).length,
    },
  };
}
