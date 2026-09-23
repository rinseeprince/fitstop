"use client";

import { useCallback, useMemo } from "react";
import {
  useClearClientGoalHistory,
  useRefreshClientGoalHistory,
  useSeedClientGoals,
} from "@/hooks/use-client-goals";
import { useClearNutritionGoal } from "@/hooks/use-nutrition-goal";
import { useClearCheckInComparisons } from "@/hooks/use-check-in-detail-data";
import type { GoalWrite } from "@/lib/goals/goal-form";
import type { ClientGoalsOverview } from "@/types/client-goals";

/**
 * Every goal write the coach makes — from the goals sheet a save's writes and
 * a delete, from the Journey's goals table a delete. Each route answers with
 * the goals as they now stand, which the caller lands (`land`) before it
 * closes its surface — the seeded read and the closing form render together
 * (CONVENTIONS §7). Landing also refreshes what is derived from goals: the
 * goals table, how nutrition follows the goal, and whether a sent check-in's
 * goal is still the client's.
 */

/** A write the goal rules refused, with the sentence that says what would clear it. */
export class GoalRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalRefusal";
  }
}

async function send(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<ClientGoalsOverview> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: ClientGoalsOverview;
    error?: string;
  } | null;
  if (res.ok && payload?.success && payload.data) return payload.data;
  if (res.status === 409) throw new GoalRefusal(payload?.error ?? "That goal can't be saved.");
  throw new Error(payload?.error || "Failed to save the goal");
}

export type GoalWrites = ReturnType<typeof useGoalWrites>;

/**
 * `historyOnScreen`: the writes come from the goals table, which is refreshed
 * in place — it keeps its rows until the new ones land, and `land` resolves
 * once they have, for the caller to close then. Elsewhere it is cleared, and
 * `land`'s work is done when it returns.
 */
export function useGoalWrites(clientId: string, historyOnScreen = false) {
  const seed = useSeedClientGoals();
  const clearHistory = useClearClientGoalHistory();
  const refreshHistory = useRefreshClientGoalHistory();
  const clearNutritionGoal = useClearNutritionGoal();
  const clearComparisons = useClearCheckInComparisons();

  /**
   * A write's answer, into the goals read — which it is, so nothing refetches
   * it — the goals table refreshed, and the other reads derived from goals
   * cleared: how nutrition follows the goal, and every cached check-in
   * comparison.
   */
  const land = useCallback(
    async (answer: ClientGoalsOverview) => {
      void seed(clientId, answer);
      void clearNutritionGoal(clientId);
      void clearComparisons();
      if (!historyOnScreen) {
        void clearHistory(clientId);
        return;
      }
      try {
        await refreshHistory(clientId);
      } catch (error) {
        // The rows on screen still hold what the write changed: dropped, the
        // table shows its loading state, then the new rows or its own error.
        console.error("Failed to refresh the goals table:", error);
        void clearHistory(clientId);
      }
    },
    [clientId, historyOnScreen, seed, clearHistory, refreshHistory, clearNutritionGoal, clearComparisons]
  );

  return useMemo(() => {
    const goals = `/api/clients/${clientId}/goals`;

    const run = (write: GoalWrite): Promise<ClientGoalsOverview> => {
      switch (write.kind) {
        case "add":
          return send("POST", goals, write.body);
        case "edit":
          return send("PATCH", `${goals}/${write.goalId}`, write.body);
        case "deadline":
          return send("PUT", `${goals}/${write.goalId}/deadline`, { deadline: write.deadline });
        case "rename":
          return send("PUT", `${goals}/${write.goalId}/name`, {
            name: write.name,
            description: write.description,
          });
      }
    };

    const remove = (goalId: string): Promise<ClientGoalsOverview> => send("DELETE", `${goals}/${goalId}`);

    return { run, remove, land };
  }, [clientId, land]);
}
