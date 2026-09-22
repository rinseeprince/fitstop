// The exercise types (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md §4.4, commit 13).
//
// A type is a fact about a CATALOG exercise, stored on its row as
// `exercise_type` (migration 185) and never copied onto a prescription or a
// log — those reference the catalog by `exercise_id`, and the columns a coach
// chose already sit on the prescription (`prescribed_fields`). A type decides
// the column preset a new exercise starts on (utils/column-presets.ts: one
// preset per type, plus Circuit) and the markers its progress chart leads with
// (utils/exercise-progress-markers.ts: one lead list per type). The keys ARE
// the preset keys, so a type's preset is a lookup, never a mapping. The CHECK in migration 185 mirrors this list, and
// exercise-types.test.ts fails if the two differ.

export const EXERCISE_TYPES = [
  "strength",
  "bodyweight",
  "endurance",
  "erg",
  "carry_sled",
  "holds",
] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** How each type is named to a coach. */
export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  strength: "Strength",
  bodyweight: "Bodyweight",
  endurance: "Endurance",
  erg: "Erg",
  carry_sled: "Carry & sled",
  holds: "Holds",
};

/**
 * Every catalog exercise starts here — the column's default and the exercise
 * form's — and an older exercise with no catalog link, which has no type,
 * charts as it.
 */
export const DEFAULT_EXERCISE_TYPE: ExerciseType = "strength";

const KNOWN: ReadonlySet<string> = new Set(EXERCISE_TYPES);

export function isExerciseType(value: unknown): value is ExerciseType {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * A stored value read as a type. The column is CHECKed, so anything else is a
 * row written outside the app; it reads as Strength rather than being trusted
 * (the same posture as toPrescribedFields).
 */
export function toExerciseType(value: string | null | undefined): ExerciseType {
  return isExerciseType(value) ? value : DEFAULT_EXERCISE_TYPE;
}
