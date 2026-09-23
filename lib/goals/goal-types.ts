/**
 * The six goal types — ONE list, shared by the questionnaire (the client picks
 * one) and the goal (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d). Migration
 * 193's CHECK on `client_goals.type` mirrors it, and `goal-types.test.ts`
 * reads the migration to hold the two together.
 *
 * Each type carries the goal's default name, the direction its progress is
 * judged in, per metric, where the type decides one — losing weight counts
 * down, building muscle counts up, a recomp counts body fat down; where the
 * type decides nothing, the direction is the side of the start the target
 * sits on — the one target a goal of the type needs, and what its deadline is
 * called. Pure: no imports, so the browser and the server share it.
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
  {
    name: string;
    direction: Partial<Record<GoalMetric, -1 | 1>>;
    /** The target a goal of this type needs; null = it asks for none. */
    target: GoalMetric | null;
    /** What the goal's deadline is called. */
    deadlineLabel: string;
  }
> = {
  lose_weight: { name: "Lose weight", direction: { weight: -1 }, target: "weight", deadlineLabel: "Deadline" },
  build_muscle: { name: "Build muscle", direction: { weight: 1 }, target: "weight", deadlineLabel: "Deadline" },
  recomposition: { name: "Recomp", direction: { bodyFat: -1 }, target: "bodyFat", deadlineLabel: "Deadline" },
  maintain: { name: "Maintain", direction: {}, target: null, deadlineLabel: "Deadline" },
  event_prep: { name: "Event prep", direction: {}, target: null, deadlineLabel: "Event day" },
  general_fitness: { name: "General fitness", direction: {}, target: null, deadlineLabel: "Deadline" },
};

export function isGoalType(value: unknown): value is GoalType {
  return typeof value === "string" && (GOAL_TYPES as readonly string[]).includes(value);
}

/** The type, said beside a goal's name — unless the name already says it. */
export function goalTypeBesideName(type: GoalType, name: string): string | null {
  const typeName = GOAL_TYPE_SETTINGS[type].name;
  return name.trim() === typeName ? null : typeName;
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
 * Which side of the client's reading a target sits on when it points the other
 * way from its type: a lose-weight target above their weight, a build-muscle
 * one below it, a recomp's body fat above theirs. null when it agrees, when the
 * type decides no direction for the metric, or with no reading. Canonical
 * units on both sides — converting never moves a target across a reading.
 */
export function targetAgainstType(
  type: GoalType,
  metric: GoalMetric,
  target: number | null,
  reading: number | null
): "above" | "below" | null {
  const direction = GOAL_TYPE_SETTINGS[type].direction[metric];
  if (direction === undefined || target == null || reading == null) return null;
  if (direction < 0 && target > reading) return "above";
  if (direction > 0 && target < reading) return "below";
  return null;
}

/**
 * A goal's type read from its targets, for a goal set with no type picked — a
 * questionnaire answered without one, which Sync metrics copies, and the seed.
 * A weight target below the client's reading is losing weight, above it
 * building muscle, on it maintaining; a body-fat target alone is a recomp;
 * anything else — no targets, or a weight target with no reading to compare it
 * with — is general fitness. Migration 193 converted the old goals by the same
 * rule, after the client's questionnaire answer.
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
