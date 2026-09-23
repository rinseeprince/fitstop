"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { GOAL_UNDO_WINDOW_MS } from "@/lib/constants";
import { useClearClientGoalHistory, useSeedClientGoals } from "@/hooks/use-client-goals";
import { useClearNutritionGoal } from "@/hooks/use-nutrition-goal";
import { useClearCheckInComparisons } from "@/hooks/use-check-in-detail-data";
import type { GoalWrite } from "@/lib/goals/goal-form";
import type { ClientGoalsOverview, GoalFix, GoalOnDay } from "@/types/client-goals";

/**
 * Every goal write the coach makes from the goals sheet: a save's writes, the
 * fixes a refusal offers, a delete and its undo. Each route answers with the
 * goals as they now stand, which the caller lands (`land`) in the same tick it
 * closes its surface — the seeded read and the closing form render together
 * (CONVENTIONS §7). Landing also clears what is derived from goals: the goal
 * history, how nutrition follows the goal, and whether a sent check-in's goal
 * is still the client's.
 */

/** A write the goal rules refused: the sentence, and the fixes it offers. */
export class GoalRefusal extends Error {
  constructor(
    message: string,
    readonly fixes: GoalFix[]
  ) {
    super(message);
    this.name = "GoalRefusal";
  }
}

type GoalsAnswer = ClientGoalsOverview & { undo?: string };

async function send(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<GoalsAnswer> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: GoalsAnswer;
    error?: string;
    fixes?: GoalFix[];
  } | null;
  if (res.ok && payload?.success && payload.data) return payload.data;
  if (res.status === 409) {
    throw new GoalRefusal(payload?.error ?? "That goal can't be saved.", payload?.fixes ?? []);
  }
  throw new Error(payload?.error || "Failed to save the goal");
}

export type GoalWrites = ReturnType<typeof useGoalWrites>;

export function useGoalWrites(clientId: string) {
  const seed = useSeedClientGoals();
  const clearHistory = useClearClientGoalHistory();
  const clearNutritionGoal = useClearNutritionGoal();
  const clearComparisons = useClearCheckInComparisons();

  /**
   * A write's answer, into the goals read — which it is, so nothing refetches
   * it — and the reads derived from goals cleared: the goal history, how
   * nutrition follows the goal, and every cached check-in comparison.
   */
  const land = useCallback(
    ({ current, planned, previous, clientToday }: ClientGoalsOverview) => {
      void seed(clientId, { current, planned, previous, clientToday });
      void clearHistory(clientId);
      void clearNutritionGoal(clientId);
      void clearComparisons();
    },
    [clientId, seed, clearHistory, clearNutritionGoal, clearComparisons]
  );

  return useMemo(() => {
    const goals = `/api/clients/${clientId}/goals`;

    const run = (write: GoalWrite): Promise<GoalsAnswer> => {
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

    /**
     * A refusal's fix that changes a goal: a planned goal moved — rewritten
     * whole on its new day — or the previous goal's deadline ended. A delete
     * fix is a delete (`remove`), made behind the destructive confirm.
     */
    const applyFix = (
      fix: Exclude<GoalFix, { kind: "delete_goal" }>,
      planned: GoalOnDay[]
    ): Promise<GoalsAnswer> => {
      switch (fix.kind) {
        case "move_goal": {
          const goal = planned.find((candidate) => candidate.id === fix.goalId);
          if (!goal) return Promise.reject(new Error(`${fix.name} is no longer planned.`));
          return send("PATCH", `${goals}/${goal.id}`, {
            type: goal.type,
            name: goal.name,
            targetWeight: goal.targetWeight,
            targetBodyFatPercentage: goal.targetBodyFatPercentage,
            description: goal.description,
            startsOn: fix.startsOn,
            deadline: goal.deadline,
          });
        }
        case "end_deadline":
          return send("PUT", `${goals}/${fix.goalId}/deadline`, { deadline: fix.deadline });
      }
    };

    const remove = (goalId: string): Promise<GoalsAnswer> => send("DELETE", `${goals}/${goalId}`);

    /**
     * "Goal deleted" with Undo, for as long as the signed copy the delete
     * handed out is good. Undo keeps the toast up until the goal is back, then
     * lands the answer and closes the toast in one tick.
     */
    const announceDeleted = (undo: string | undefined) => {
      if (!undo) return;
      let restoring = false;
      const id = toast.success("Goal deleted", {
        duration: GOAL_UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: (event) => {
            event.preventDefault();
            if (restoring) return;
            restoring = true;
            void (async () => {
              try {
                const answer = await send("POST", `${goals}/restore`, { undo });
                land(answer);
                toast.dismiss(id);
                toast.success("Goal restored");
              } catch (error) {
                toast.dismiss(id);
                toast.error("Undo failed", {
                  description: error instanceof Error ? error.message : "Something went wrong",
                });
              }
            })();
          },
        },
      });
    };

    return { run, applyFix, remove, announceDeleted, land };
  }, [clientId, land]);
}
