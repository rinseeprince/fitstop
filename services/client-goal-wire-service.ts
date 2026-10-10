import { getGoalForDate } from "./client-goals-service";
import { getReadingsOnDay } from "./measurements-service";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { ClientGoalWire } from "@/types/client-goal-wire";

/**
 * The client's goal card read (GET /api/client/goal): the goal in force on the
 * client's today, with that day's deadline — the same goal every client wire
 * carries (`getGoalForDate`, services/client-goals-service.ts) — and the
 * readings on its start day, which its progress runs from. The newest
 * readings, which its progress runs to, are the client's profile's
 * (GET /api/client/me), so they are not read again here.
 *
 * Everything is canonical kilograms (CONVENTIONS §20); the renderer converts.
 *
 * Shape B: the route verifies the caller IS this client and hands the client's
 * today down; every query filters on the passed clientId.
 */
export const getClientGoalWire = async (
  clientId: string,
  clientToday: string
): Promise<ClientGoalWire> => {
  const goalToday = await getGoalForDate(clientId, clientToday);
  const onStart = goalToday ? await getReadingsOnDay(clientId, goalToday.startsOn) : null;

  // The goal in force on the client's today, from one goal: its weight target
  // and deadline as the calculator reads them — no goal, or no weight target,
  // ships a null weight — and what the client's goal card shows.
  const effective = resolveEffectiveGoal(goalToday);
  return {
    goal: {
      weightKg: effective.goalWeightKg,
      deadline: effective.deadline,
      name: goalToday?.name ?? null,
      type: goalToday?.type ?? null,
      bodyFatPercentage: effective.goalBodyFatPercentage,
      description: goalToday?.description ?? null,
      startReadings: onStart
        ? {
            weightKg: onStart.weight?.value ?? null,
            bodyFatPercentage: onStart.bodyFat?.value ?? null,
          }
        : null,
    },
  };
};
