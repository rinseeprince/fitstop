import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionForDate } from "./daily-context-service";
import { getTodayLog } from "./daily-logs-service";
import { getClientHabits, getTodayHabitLogs } from "./daily-habits-service";
import { getClientProgram } from "./client-program-service";
import type { DaySummary, PhaseSummary } from "@/types/client-day";
import type { ClientProgram } from "@/types/client-program";

/**
 * Lightweight day summary for the client home screen.
 * Composes existing domain services — does not query tables directly.
 */
export async function getDaySummary(
  clientId: string,
  date: string
): Promise<DaySummary> {
  const [trainingEvents, nutrition, dailyLog, habits, habitLogs, program] =
    await Promise.all([
      getEventSummariesForDate(clientId, date),
      getNutritionForDate(clientId, date),
      getTodayLog(clientId, date),
      getClientHabits(clientId),
      getTodayHabitLogs(clientId, date),
      getClientProgram(clientId),
    ]);

  return {
    phase: derivePhaseSummary(program, date),
    training: trainingEvents,
    // Log-authoritative: a nutrition_logs row (source "log") means logged, even if the
    // nutrition_event status was never flipped. consumed/target drive the home card numbers.
    nutrition:
      nutrition.source !== null
        ? {
            hasLog: nutrition.source === "log",
            caloriesConsumed: nutrition.consumed?.calories ?? null,
            targetCalories: nutrition.target?.calories ?? null,
          }
        : null,
    wellness: {
      hasLog:
        dailyLog != null &&
        (dailyLog.mood != null ||
          dailyLog.energy != null ||
          dailyLog.sleep != null ||
          dailyLog.stress != null),
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

function derivePhaseSummary(
  program: ClientProgram | null,
  date: string
): PhaseSummary | null {
  if (!program) return null;

  if (program.activePhaseId) {
    const active = program.phases.find((p) => p.id === program.activePhaseId);
    if (!active) return null;
    return {
      id: active.id,
      name: active.name,
      weekInPhase: computeWeekInPhase(active.startDate, date),
      goal: active.description,
      state: "active",
    };
  }

  const incoming = program.phases
    .filter((p) => p.status === "planned")
    .sort((a, b) => a.orderIndex - b.orderIndex)[0];
  if (!incoming) return null;

  return {
    id: incoming.id,
    name: incoming.name,
    weekInPhase: null,
    goal: incoming.description,
    state: "transitioning",
  };
}

function computeWeekInPhase(
  startDate: string | null,
  date: string
): number | null {
  if (!startDate) return null;
  const start = new Date(startDate + "T00:00:00").getTime();
  const target = new Date(date + "T00:00:00").getTime();
  if (target < start) return null;
  const days = Math.floor((target - start) / 86_400_000);
  return Math.floor(days / 7) + 1;
}
