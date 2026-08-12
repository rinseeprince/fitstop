/**
 * Single source of truth for "which goal drives this client right now?".
 *
 * A client has one long-term goal (`client_goals`); a null weight means
 * **maintenance** — the "zero active goal" case is represented purely by
 * `goalWeightKg: null`.
 *
 * This function is PURE: callers fetch the live client goal and pass it in.
 *
 * It no longer normalizes units. `client_goals.goal_weight` is canonical
 * kilograms since migration 141, so there is nothing to convert and no
 * `weightUnit` to pass — the old parameter is gone rather than ignored, so a
 * caller still holding a display unit fails to compile instead of silently
 * having it dropped.
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
 * The client's long-term goal. `goalWeight` is kilograms, like everything else
 * stored. null = no live goal at all (→ maintenance).
 */
export type ClientGoalInput = {
  goalWeight: number | null;
  goalBodyFatPercentage: number | null;
  deadline: string | null;
  /** `client_goals.goal_start_date`. */
  startDate: string | null;
};

export type ResolveEffectiveGoalInput = {
  /** null = no live client goal. */
  clientGoal: ClientGoalInput | null;
  /** ISO YYYY-MM-DD; used as the start-date fallback. */
  today: string;
};

export function resolveEffectiveGoal(
  input: ResolveEffectiveGoalInput
): EffectiveGoal {
  const { clientGoal, today } = input;

  // The long-term client goal drives (null weight = maintenance).
  return {
    goalWeightKg: clientGoal?.goalWeight ?? null,
    goalBodyFatPercentage: clientGoal?.goalBodyFatPercentage ?? null,
    deadline: clientGoal?.deadline ?? null,
    startDate: clientGoal?.startDate ?? today,
  };
}

/**
 * Builds this resolver's input from the live `client_goals` record plus the
 * denormalized `clients` mirror. Every caller composed this literal by hand and
 * all of them agreed character for character, which is exactly the shape that
 * drifts silently the first time one of them is edited alone.
 *
 * `today` deliberately stays at the call site: the anchor is "whose calendar is
 * this date on?", and the answer differs per surface (client-local for pace and
 * the coach Overview, the resolved client day for the nutrition write path).
 *
 * **Weight and body fat keep a mirror leg; the deadline does not.** That is not
 * an oversight:
 *
 * - `mapClientRow` maps `goal_weight` and `goal_body_fat_percentage`, so the
 *   `?? client.*` legs are the documented read switch for a client whose goal
 *   predates `client_goals`.
 * - It has never mapped `goal_deadline`, so `Client.goalDeadline` was ALWAYS
 *   `undefined` and the third leg was unreachable code at three call sites.
 *   Owner decision 2026-08-12 (Session 4 Task 4.2): delete it rather than map
 *   the column. Mapping would have made a silently-divergeable mirror deadline
 *   reachable in three calculator/pace paths for the first time — the mirror's
 *   dual-write is logged-and-swallowed. Deleting is zero behaviour change.
 *
 * Params are structural rather than `Client`/`ClientGoal` so this module keeps
 * its zero imports and stays usable from the browser, the route layer and the
 * services alike.
 */
export function toClientGoalInput(
  currentGoals:
    | {
        goalWeight?: number | null;
        goalBodyFatPercentage?: number | null;
        goalDeadline?: string | null;
        goalStartDate?: string | null;
      }
    | null
    | undefined,
  client: {
    goalWeight?: number | null;
    goalBodyFatPercentage?: number | null;
  }
): ClientGoalInput {
  return {
    goalWeight: currentGoals?.goalWeight ?? client.goalWeight ?? null,
    goalBodyFatPercentage:
      currentGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage ?? null,
    deadline: currentGoals?.goalDeadline ?? null,
    startDate: currentGoals?.goalStartDate ?? null,
  };
}
