import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionForDate } from "./daily-context-service";
import { getTodayLog } from "./daily-logs-service";
import { getClientHabits, getTodayHabitLogs } from "./daily-habits-service";
import type { DaySummary } from "@/types/client-day";

/**
 * Lightweight day summary for the client home screen.
 * Composes existing domain services — does not query tables directly.
 *
 * Training is the day's events and nothing else: a workout has one date (the
 * event's), because the client moves the event to the day they train. The
 * "trained for another day" read that used to sit beside this was retired with
 * the receipt model (2026-08-26).
 */
export async function getDaySummary(
  clientId: string,
  date: string
): Promise<DaySummary> {
  const [trainingEvents, nutrition, dailyLog, habits, habitLogs] =
    await Promise.all([
      getEventSummariesForDate(clientId, date),
      getNutritionForDate(clientId, date),
      getTodayLog(clientId, date),
      getClientHabits(clientId),
      getTodayHabitLogs(clientId, date),
    ]);

  return {
    training: trainingEvents,
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
