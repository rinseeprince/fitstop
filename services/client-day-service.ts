import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getTodayLog } from "./daily-logs-service";
import { getClientHabits, getTodayHabitLogs } from "./daily-habits-service";
import type { DaySummary } from "@/types/client-day";

/**
 * Lightweight day summary for the client home screen.
 * Composes existing domain services — does not query tables directly.
 */
export async function getDaySummary(
  clientId: string,
  date: string
): Promise<DaySummary> {
  const [trainingEvents, nutritionEvent, dailyLog, habits, habitLogs] =
    await Promise.all([
      getEventSummariesForDate(clientId, date),
      getNutritionEventForDate(clientId, date),
      getTodayLog(clientId, date),
      getClientHabits(clientId),
      getTodayHabitLogs(clientId, date),
    ]);

  return {
    training: trainingEvents,
    nutrition: nutritionEvent !== null
      ? { hasLog: nutritionEvent.status === "logged" }
      : null,
    wellness: {
      hasLog:
        dailyLog != null &&
        (dailyLog.mood != null ||
          dailyLog.energy != null ||
          dailyLog.sleep != null ||
          dailyLog.stress != null),
    },
    habits: {
      totalCount: habits.length,
      loggedCount: habitLogs.filter((l) => l.completed).length,
    },
  };
}
