import type { GoalType } from "@/lib/goals/goal-types";

// Wire types for GET /api/client/goal — the client's goal card on the Program
// tab. Weights are canonical kilograms with no unit tags and no rounding
// (CONVENTIONS §20; the renderer converts to the viewer's unit, rounds, then
// subtracts for the "to go" line).

/** The readings on the goal's start day, which its progress runs from (kg, %):
 *  per metric, the newest live reading dated on or before that day, else the
 *  first one after it. The newest readings, which its progress runs to, are
 *  the client's profile's (GET /api/client/me). */
export interface ClientGoalStartReadings {
  weightKg: number | null;
  bodyFatPercentage: number | null;
}

/** The goal in force on the client's today (`client_goals`), with that day's
 *  deadline. A planned goal is not here before its day. `weightKg` is resolved
 *  through resolveEffectiveGoal: null means maintenance. The rest are what the
 *  client's goal card shows — optional on the wire, all null when no goal is
 *  in force; `description` is the goal's own words, the client's for the goal
 *  their questionnaire set. */
export interface ClientGoal {
  weightKg: number | null;
  deadline: string | null;
  name?: string | null;
  type?: GoalType | null;
  bodyFatPercentage?: number | null;
  description?: string | null;
  startReadings?: ClientGoalStartReadings | null;
}

/** GET /api/client/goal's `data`. */
export interface ClientGoalWire {
  goal: ClientGoal;
}
