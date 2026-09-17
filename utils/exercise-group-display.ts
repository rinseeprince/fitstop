import type { GroupFormat, GroupSettings } from "./exercise-groups";
import { formatRepsRange } from "./reps-range";
import { isContinuationOfDropSet, restAfterRow, type PrescribedRow } from "./set-spec-rows";

// How a group reads to a client or a coach (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md
// section 4.2). A group of one is a plain exercise, exactly as it was before
// groups existed; only a linked group (two or more exercises) reads as a group,
// and it is known by its format's name, never a letter (owner, 2026-09-16).
//
// Pure and client-safe. The client's workout, their program page and the
// coach's workout log view all read groups through this module, and
// CLIENT-APP-REFERENCE.md states the same rules for the React Native app.

/** Two or more exercises: the only groups that read as a group. */
export function isLinkedGroup(group: { exercises: ReadonlyArray<unknown> }): boolean {
  return group.exercises.length > 1;
}

/** What coaches and clients call a linked group. */
export function groupName(format: GroupFormat, exerciseCount: number): string {
  switch (format) {
    case "straight_sets":
      return "Straight sets";
    case "circuit":
      return exerciseCount > 2 ? "Circuit" : "Superset";
    case "amrap":
      return "AMRAP";
    case "emom":
      return "EMOM";
    case "for_time":
      return "For time";
  }
}

/** "45s", "1m", "1m 30s". */
export function formatRestDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** One rest a linked group prescribes: "30s" + "rest between exercises", or no duration for "No rest …". */
type GroupRest = { duration: string | null; words: string };

/** A linked group's heading, in parts, so a renderer can set the numbers apart. */
type GroupHeading = {
  name: string;
  /** The coach's rounds, only where the group's rows are rounds. */
  rounds: { count: number; words: "round" | "rounds" } | null;
  /** Between exercises, then between rounds; a rest the coach didn't set is absent. */
  rests: GroupRest[];
  notes: string | null;
};

function groupRest(seconds: number | null, between: "exercises" | "rounds"): GroupRest[] {
  if (seconds == null) return [];
  return seconds > 0
    ? [{ duration: formatRestDuration(seconds), words: `rest between ${between}` }]
    : [{ duration: null, words: `No rest between ${between}` }];
}

export function groupHeading(group: GroupSettings & { exercises: ReadonlyArray<unknown> }): GroupHeading {
  const looped = group.format !== "straight_sets";
  return {
    name: groupName(group.format, group.exercises.length),
    rounds:
      looped && group.rounds != null
        ? { count: group.rounds, words: group.rounds === 1 ? "round" : "rounds" }
        : null,
    rests: [
      ...groupRest(group.restBetweenExercisesSeconds, "exercises"),
      ...(looped ? groupRest(group.restBetweenRoundsSeconds, "rounds") : []),
    ],
    notes: group.notes,
  };
}

/** "Superset · 3 rounds" and "30s rest between exercises · 1m 30s rest between rounds", as plain text. */
export function groupHeadingText(heading: GroupHeading): { title: string; rests: string | null } {
  const title = heading.rounds
    ? `${heading.name} · ${heading.rounds.count} ${heading.rounds.words}`
    : heading.name;
  const rests = heading.rests
    .map((rest) => (rest.duration ? `${rest.duration} ${rest.words}` : rest.words))
    .join(" · ");
  return { title, rests: rests || null };
}

/** Where an exercise stands in its group: what its rows are, and which rests follow them. */
export type ExerciseGroupPlace = {
  /** In a linked group. A lone exercise reads exactly as a plain exercise. */
  linked: boolean;
  /** In a linked group of any format but straight sets, each row is a round. */
  roundsAreRows: boolean;
  isLastExercise: boolean;
  restBetweenExercisesSeconds: number | null;
  restBetweenRoundsSeconds: number | null;
};

export const LONE_EXERCISE: Readonly<ExerciseGroupPlace> = Object.freeze({
  linked: false,
  roundsAreRows: false,
  isLastExercise: true,
  restBetweenExercisesSeconds: null,
  restBetweenRoundsSeconds: null,
});

/** The place of the exercise at `position` in `group`. */
export function exerciseGroupPlace(
  group: GroupSettings & { exercises: ReadonlyArray<unknown> },
  position: number,
): ExerciseGroupPlace {
  if (!isLinkedGroup(group)) return LONE_EXERCISE;
  return {
    linked: true,
    roundsAreRows: group.format !== "straight_sets",
    isLastExercise: position >= group.exercises.length - 1,
    restBetweenExercisesSeconds: group.restBetweenExercisesSeconds,
    restBetweenRoundsSeconds: group.restBetweenRoundsSeconds,
  };
}

/**
 * The rest that follows row `index` of an exercise, or null when none does.
 *
 * A lone exercise is `restAfterRow`, gated by its Rest column (`ownRest`). In a
 * linked group the next thing done decides it:
 * - rows are rounds: the next exercise in the group follows, so the group's rest
 *   between exercises; after the last exercise the next round follows, so the
 *   rest between rounds; after its final round nothing does. The exercise's own
 *   per-set rest is not used.
 * - straight sets: the exercise's own rests between its sets, and the group's
 *   rest between exercises after its last set, unless it is the last exercise.
 * Never mid drop set, and a rest of 0 is no rest.
 *
 * `rowCount` is the rows on screen, which can run past the prescription when the
 * client adds rows.
 */
export function restAfterGroupedRow(
  rows: PrescribedRow[],
  index: number,
  rowCount: number,
  place: Readonly<ExerciseGroupPlace>,
  ownRest: boolean,
): number | null {
  if (!place.linked) return ownRest ? restAfterRow(rows, index, rowCount) : null;
  if (index < 0 || index >= rowCount) return null;
  if (isContinuationOfDropSet(rows, index + 1)) return null;

  const lastRow = index === rowCount - 1;
  let seconds: number | null;
  if (place.roundsAreRows) {
    seconds = !place.isLastExercise
      ? place.restBetweenExercisesSeconds
      : lastRow
        ? null
        : place.restBetweenRoundsSeconds;
  } else if (!lastRow) {
    return ownRest ? restAfterRow(rows, index, rowCount) : null;
  } else {
    seconds = place.isLastExercise ? null : place.restBetweenExercisesSeconds;
  }
  return seconds != null && seconds > 0 ? seconds : null;
}

// Each round's reps, in order (a drop's rows continue their round), or null
// when a round asks no rep count.
function roundReps(rows: PrescribedRow[]): string[] | null {
  const reps = rows
    .filter((row) => row.dropIndex == null)
    .map((row) => row.repsTarget ?? formatRepsRange({ min: row.repsMin, max: row.repsMax }));
  return reps.length === 0 || reps.some((text) => text === "") ? null : reps;
}

// Single counts read as a rep scheme (21-15-9); a range among them needs a
// separator a range can't contain.
const repScheme = (reps: string[]) =>
  reps.join(reps.every((text) => /^\d+$/.test(text)) ? "-" : ", ");

/**
 * An exercise's reps round by round, where its rows are rounds: "21-15-9 reps",
 * or "8-10 reps" when every round asks the same. Null when a round asks no rep
 * count, so nothing half-true is shown.
 */
export function formatRoundReps(rows: PrescribedRow[]): string | null {
  const reps = roundReps(rows);
  if (!reps) return null;
  return new Set(reps).size === 1 ? `${reps[0]} reps` : `${repScheme(reps)} reps`;
}

/**
 * The same, dense, for a card with no room for the group's heading (the
 * builder's week grid): "3×8-10" — rounds × reps — when every round asks the
 * same, else the scheme alone, "21-15-9". Null when a round asks no rep count.
 */
export function formatRoundRepsShort(rows: PrescribedRow[]): string | null {
  const reps = roundReps(rows);
  if (!reps) return null;
  return new Set(reps).size === 1 ? `${reps.length}×${reps[0]}` : repScheme(reps);
}
