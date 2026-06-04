import { weightToKg } from "@/utils/nutrition-helpers";

/**
 * Single source of truth for "which goal drives this client right now?".
 *
 * Locked model (Sessions 7.8–7.11): a client always has one long-term goal
 * (`client_goals`). A roadmap is optional and always has a phase. While a phase
 * is **active** it ALWAYS drives nutrition/training — phase target + phase dates,
 * and a NULL phase weight means **maintenance** (there is NO fallback to the
 * client's long-term weight). With no active phase, the long-term client goal
 * drives. The "zero active goal" / maintenance case is represented purely by
 * `goalWeightKg: null` — never a third source value.
 *
 * This function is PURE: callers fetch the inputs (active phase, live client
 * goal, weight unit) and pass them in. It is the ONE place display-unit goal
 * weights are normalized to kg; phase weights are already kg and pass through.
 */

export type EffectiveGoalSource = "phase" | "client";

export type EffectiveGoal = {
  /** kg, or null for maintenance / no active weight target. */
  goalWeightKg: number | null;
  goalBodyFatPercentage: number | null;
  /** ISO YYYY-MM-DD, or null when no deadline is set. */
  deadline: string | null;
  /** ISO YYYY-MM-DD; falls back to `today` when the scope has no start date. */
  startDate: string;
  source: EffectiveGoalSource;
};

/**
 * The client's currently-active phase, when one exists. `goalWeightKg` is already
 * in kg (`phase_goal_weight` is stored in kg); a null value is a maintenance
 * prescription, NOT "fall back to the client goal".
 */
export type ActivePhaseGoalInput = {
  goalWeightKg: number | null;
  goalBodyFatPercentage: number | null;
  startDate: string | null;
  endDate: string | null;
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
  /** null = no active phase. */
  activePhase: ActivePhaseGoalInput | null;
  /** null = no live client goal. */
  clientGoal: ClientGoalInput | null;
  /** ISO YYYY-MM-DD; used as the start-date fallback. */
  today: string;
};

export function resolveEffectiveGoal(
  input: ResolveEffectiveGoalInput
): EffectiveGoal {
  const { weightUnit, activePhase, clientGoal, today } = input;

  // Phase-is-king: an active phase always drives. A null phase weight is
  // maintenance — we deliberately do NOT fall back to the client goal here.
  if (activePhase) {
    return {
      goalWeightKg: activePhase.goalWeightKg,
      goalBodyFatPercentage: activePhase.goalBodyFatPercentage,
      deadline: activePhase.endDate,
      startDate: activePhase.startDate ?? today,
      source: "phase",
    };
  }

  // No active phase → the long-term client goal drives (null weight = maintenance).
  return {
    goalWeightKg:
      clientGoal?.goalWeight != null
        ? weightToKg(clientGoal.goalWeight, weightUnit)
        : null,
    goalBodyFatPercentage: clientGoal?.goalBodyFatPercentage ?? null,
    deadline: clientGoal?.deadline ?? null,
    startDate: clientGoal?.startDate ?? today,
    source: "client",
  };
}
