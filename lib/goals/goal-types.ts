/**
 * The six goal types — ONE list, shared by the questionnaire (the client picks
 * one) and the goal (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d). Migration
 * 193's CHECK on `client_goals.type` mirrors it, and `goal-types.test.ts`
 * reads the migration to hold the two together.
 *
 * Each type carries the goal's default name and the direction its progress is
 * judged in, per metric, where the type decides one: losing weight counts
 * down, building muscle counts up, a recomp counts body fat down. Where the
 * type decides nothing, the direction is the side of the start the target
 * sits on. Pure: no imports, so the browser and the server share it.
 */
export const GOAL_TYPES = [
  "lose_weight",
  "build_muscle",
  "recomposition",
  "maintain",
  "event_prep",
  "general_fitness",
] as const;

export type GoalType = (typeof GOAL_TYPES)[number];

/** The two readings a goal can target. */
export type GoalMetric = "weight" | "bodyFat";

type Direction = -1 | 0 | 1;

export const GOAL_TYPE_SETTINGS: Record<
  GoalType,
  { name: string; direction: Partial<Record<GoalMetric, -1 | 1>> }
> = {
  lose_weight: { name: "Lose weight", direction: { weight: -1 } },
  build_muscle: { name: "Build muscle", direction: { weight: 1 } },
  recomposition: { name: "Recomp", direction: { bodyFat: -1 } },
  maintain: { name: "Maintain", direction: {} },
  event_prep: { name: "Event prep", direction: {} },
  general_fitness: { name: "General fitness", direction: {} },
};

export function isGoalType(value: unknown): value is GoalType {
  return typeof value === "string" && (GOAL_TYPES as readonly string[]).includes(value);
}

/**
 * The way a goal's target is approached: the type's direction where it
 * decides one, else the side of the start the target sits on — none without a
 * start, or with the start already on the target.
 */
export function goalDirection(
  type: GoalType | null | undefined,
  metric: GoalMetric,
  target: number,
  start: number | null | undefined
): Direction {
  const fromType = type ? GOAL_TYPE_SETTINGS[type].direction[metric] : undefined;
  if (fromType !== undefined) return fromType;
  if (start == null) return 0;
  return Math.sign(target - start) as Direction;
}

/**
 * A goal's type read from its targets, for the two places a goal is set with
 * no type to pick — the details sheet and the Add-client form, until commit
 * 8d2 gives them one. A weight target below the client's reading is losing
 * weight, above it building muscle, on it maintaining; a body-fat target alone
 * is a recomp; anything else — no targets, or a weight target with no reading
 * to compare it with — is general fitness. Migration 193 converted the old
 * goals by the same rule, after the client's questionnaire answer.
 */
export function goalTypeFromTargets({
  targetWeight,
  targetBodyFatPercentage,
  reading,
}: {
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  /** The client's weight on the goal's start day, if they have one. */
  reading: number | null;
}): GoalType {
  if (targetWeight != null && reading != null) {
    if (targetWeight < reading) return "lose_weight";
    if (targetWeight > reading) return "build_muscle";
    return "maintain";
  }
  if (targetWeight == null && targetBodyFatPercentage != null) return "recomposition";
  return "general_fitness";
}
