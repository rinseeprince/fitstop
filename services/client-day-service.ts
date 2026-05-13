import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionEventForDate } from "./nutrition-event-service";
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
  const [trainingEvents, nutritionEvent, dailyLog, habits, habitLogs, program] =
    await Promise.all([
      getEventSummariesForDate(clientId, date),
      getNutritionEventForDate(clientId, date),
      getTodayLog(clientId, date),
      getClientHabits(clientId),
      getTodayHabitLogs(clientId, date),
      getClientProgram(clientId),
    ]);

  return {
    phase: derivePhaseSummary(program, date),
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
