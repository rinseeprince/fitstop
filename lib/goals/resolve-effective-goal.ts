import { weightToKg } from "@/utils/nutrition-helpers";
import { getPhaseForDate } from "@/lib/goals/phase-chain";

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
  /**
   * The rate prescribed by the block covering `date`, in kg per week, or null
   * when no block covers it (or the caller passed none).
   *
   * This is the ONE thing a block contributes. Blocks carry a rate and nothing
   * else — no target weight, no deadline (invariant 4) — so `goalWeightKg` and
   * `deadline` above are unaffected by blocks in every case, and a client with
   * no blocks resolves exactly as they did before this field existed.
   *
   * Signed: negative loses weight, positive gains, and `0` is maintenance
   * explicitly rather than "unset" (invariant 5).
   */
  phaseRateKgPerWeek: number | null;
  /** The covering block's name, for display. Null when no block covers `date`. */
  phaseName: string | null;
};

/** The minimum a caller must supply per block for date-aware resolution. */
export type EffectivePhaseInput = {
  name: string;
  startsOn: string;
  endsOn: string;
  ratePerWeekKg: number;
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
  /**
   * The client's blocks. Omit (or pass an empty list) and every returned field
   * is identical to what this function returned before blocks existed — which is
   * the property that makes blocks safe to ship for existing clients.
   */
  phases?: EffectivePhaseInput[];
  /**
   * The date this resolution is FOR. Defaults to `today`.
   *
   * The goal is a destination and does not vary by date; only the RATE does, so
   * this parameter exists solely to pick the covering block. Callers asking a
   * date-specific question pass one — the check-in comparison anchors on the
   * period's end, and per-block plan generation passes each block's own dates.
   */
  date?: string;
};

export function resolveEffectiveGoal(
  input: ResolveEffectiveGoalInput
): EffectiveGoal {
  const { weightUnit, clientGoal, today, phases, date } = input;

  const coveringPhase = phases?.length
    ? getPhaseForDate(phases, date ?? today)
    : null;

  // The long-term client goal drives the destination (null weight = maintenance);
  // a covering block, when there is one, drives the speed.
  return {
    goalWeightKg:
      clientGoal?.goalWeight != null
        ? weightToKg(clientGoal.goalWeight, weightUnit)
        : null,
    goalBodyFatPercentage: clientGoal?.goalBodyFatPercentage ?? null,
    deadline: clientGoal?.deadline ?? null,
    startDate: clientGoal?.startDate ?? today,
    phaseRateKgPerWeek: coveringPhase ? Number(coveringPhase.ratePerWeekKg) : null,
    phaseName: coveringPhase?.name ?? null,
  };
}
