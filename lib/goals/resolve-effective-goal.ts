import { weightToKg } from "@/utils/nutrition-helpers";

/**
 * Single source of truth for "which goal drives this client right now?".
 *
 * A client has one long-term goal (`client_goals`); a null weight means
 * **maintenance** — the "zero active goal" case is represented purely by
 * `goalWeightKg: null`.
 *
 * This function is PURE: callers fetch the inputs (live client goal, weight
 * unit) and pass them in. It is the ONE place display-unit goal weights are
 * normalized to kg.
 */

export type EffectiveGoal = {
  /** kg, or null for maintenance / no active weight target. */
  goalWeightKg: number | null;
  goalBodyFatPercentage: number | null;
  /** ISO YYYY-MM-DD, or null when no deadline is set. */
  deadline: string | null;
  /** ISO YYYY-MM-DD; falls back to `today` when the goal has no start date. */
  startDate: string;
};

/**
 * The client's long-term goal in DISPLAY units (the resolver normalizes weight
 * to kg). null = no live goal at all (→ maintenance).
 */
export type ClientGoalInput = {
  goalWeight: number | null;
  goalBodyFatPercentage: number | null;
  deadline: string | null;
  /** `client_goals.goal_start_date`. */
  startDate: string | null;
};

export type ResolveEffectiveGoalInput = {
  weightUnit: "lbs" | "kg";
  /** null = no live client goal. */
  clientGoal: ClientGoalInput | null;
  /** ISO YYYY-MM-DD; used as the start-date fallback. */
  today: string;
};

export function resolveEffectiveGoal(
  input: ResolveEffectiveGoalInput
): EffectiveGoal {
  const { weightUnit, clientGoal, today } = input;

  // The long-term client goal drives (null weight = maintenance).
  return {
    goalWeightKg:
      clientGoal?.goalWeight != null
        ? weightToKg(clientGoal.goalWeight, weightUnit)
        : null,
    goalBodyFatPercentage: clientGoal?.goalBodyFatPercentage ?? null,
    deadline: clientGoal?.deadline ?? null,
    startDate: clientGoal?.startDate ?? today,
  };
}
