import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionForDate } from "./daily-context-service";
import { getTodayLog } from "./daily-logs-service";
import { getHabitDaySummary } from "./client-habit-figures-service";
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
  const [trainingEvents, nutrition, dailyLog, habits] =
    await Promise.all([
      getEventSummariesForDate(clientId, date),
      getNutritionForDate(clientId, date),
      getTodayLog(clientId, date),
      getHabitDaySummary(clientId, date),
    ]);

  return {
    training: trainingEvents,
    // Every day has a nutrition section: any day the day rule leaves open takes a
    // log, with a target or without one. Log-authoritative: a nutrition_logs row
    // (source "log") means logged. consumed/target drive the home card numbers;
    // targetCalories is null when no nutrition plan covers the day.
    nutrition: {
      hasLog: nutrition.source === "log",
      caloriesConsumed: nutrition.consumed?.calories ?? null,
      targetCalories: nutrition.target?.calories ?? null,
      // The coach's per-day note rides on the day's target. Surfaced on the
      // home card since future days aren't openable.
      note: nutrition.target?.note ?? null,
    },
    wellness: {
      hasLog:
        dailyLog != null &&
        (dailyLog.mood != null ||
          dailyLog.energy != null ||
          dailyLog.sleep != null ||
          dailyLog.stress != null ||
          dailyLog.soreness != null),
    },
    // The habits a version covers on the day, the ones planned on it, how many
    // of those were done that day — the habit kernel's day, so the done count
    // is never more than the planned one — and what the day's week still asks.
    habits,
  };
}
