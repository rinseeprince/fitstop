import { describe, expect, it } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import { STRAIGHT_SETS, type GroupSettings } from "./exercise-groups";
import { buildPrescribedRows, restAfterRow } from "./set-spec-rows";
import {
  LONE_EXERCISE,
  exerciseGroupPlace,
  formatRestDuration,
  formatRoundReps,
  groupHeading,
  groupHeadingText,
  groupName,
  isLinkedGroup,
  restAfterGroupedRow,
  type ExerciseGroupPlace,
} from "./exercise-group-display";

const spec = (over: Partial<SetSpec> & { set_number: number }): SetSpec => ({
  set_type: "working",
  ...over,
});

const threeRounds = (rest: number | null = null) =>
  buildPrescribedRows([1, 2, 3].map((n) => spec({ set_number: n, reps_min: 10, reps_max: 10, rest_seconds: rest })));

const group = (settings: Partial<GroupSettings>, exerciseCount: number) => ({
  ...STRAIGHT_SETS,
  ...settings,
  exercises: Array.from({ length: exerciseCount }, (_, i) => `ex-${i}`),
});

const SUPERSET = group(
  { format: "circuit", rounds: 3, restBetweenExercisesSeconds: 30, restBetweenRoundsSeconds: 90 },
  2,
);

describe("which groups read as a group", () => {
  it("is only a group of two or more", () => {
    expect(isLinkedGroup(group({}, 1))).toBe(false);
    expect(isLinkedGroup(group({ format: "circuit" }, 1))).toBe(false);
    expect(isLinkedGroup(group({}, 2))).toBe(true);
  });
});

describe("groupName", () => {
  it("calls a looped pair a superset and three or more a circuit", () => {
    expect(groupName("circuit", 2)).toBe("Superset");
    expect(groupName("circuit", 3)).toBe("Circuit");
    expect(groupName("circuit", 6)).toBe("Circuit");
  });

  it("names every other format by its own name, never a letter", () => {
    expect(groupName("straight_sets", 2)).toBe("Straight sets");
    expect(groupName("amrap", 2)).toBe("AMRAP");
    expect(groupName("emom", 2)).toBe("EMOM");
    expect(groupName("for_time", 2)).toBe("For time");
  });
});

describe("formatRestDuration", () => {
  it("reads seconds under a minute, then minutes and seconds", () => {
    expect(formatRestDuration(0)).toBe("0s");
    expect(formatRestDuration(45)).toBe("45s");
    expect(formatRestDuration(60)).toBe("1m");
    expect(formatRestDuration(90)).toBe("1m 30s");
    expect(formatRestDuration(3600)).toBe("60m");
  });
});

describe("groupHeading", () => {
  it("names the group, its rounds, its rests in the order they come, and its notes", () => {
    const heading = groupHeading({ ...SUPERSET, notes: "Back to back" });
    expect(heading).toEqual({
      name: "Superset",
      rounds: { count: 3, words: "rounds" },
      rests: [
        { duration: "30s", words: "rest between exercises" },
        { duration: "1m 30s", words: "rest between rounds" },
      ],
      notes: "Back to back",
    });
    expect(groupHeadingText(heading)).toEqual({
      title: "Superset · 3 rounds",
      rests: "30s rest between exercises · 1m 30s rest between rounds",
    });
  });

  it("says no rest for a rest of 0, and nothing for a rest the coach didn't set", () => {
    const heading = groupHeading({ ...SUPERSET, restBetweenExercisesSeconds: 0, restBetweenRoundsSeconds: null });
    expect(heading.rests).toEqual([{ duration: null, words: "No rest between exercises" }]);
    expect(groupHeadingText(heading).rests).toBe("No rest between exercises");
    expect(groupHeadingText(groupHeading({ ...SUPERSET, restBetweenExercisesSeconds: null, restBetweenRoundsSeconds: null })).rests).toBeNull();
  });

  it("gives one round its singular, and no rounds when none are set", () => {
    expect(groupHeadingText(groupHeading({ ...SUPERSET, rounds: 1 })).title).toBe("Superset · 1 round");
    expect(groupHeadingText(groupHeading({ ...SUPERSET, rounds: null })).title).toBe("Superset");
  });

  it("gives a linked straight-sets group no rounds and no rest between rounds, which it can't have", () => {
    const heading = groupHeading(
      group({ rounds: 3, restBetweenExercisesSeconds: 60, restBetweenRoundsSeconds: 90 }, 2),
    );
    expect(heading.rounds).toBeNull();
    expect(heading.rests).toEqual([{ duration: "1m", words: "rest between exercises" }]);
    expect(groupHeadingText(heading)).toEqual({
      title: "Straight sets",
      rests: "1m rest between exercises",
    });
  });
});

describe("exerciseGroupPlace", () => {
  it("is a plain exercise in a group of one, whatever the group's format", () => {
    expect(exerciseGroupPlace(group({}, 1), 0)).toBe(LONE_EXERCISE);
    expect(exerciseGroupPlace(group({ format: "circuit", rounds: 3 }, 1), 0)).toBe(LONE_EXERCISE);
  });

  it("knows the last exercise of a linked group and whether its rows are rounds", () => {
    expect(exerciseGroupPlace(SUPERSET, 0)).toEqual({
      linked: true,
      roundsAreRows: true,
      isLastExercise: false,
      restBetweenExercisesSeconds: 30,
      restBetweenRoundsSeconds: 90,
    });
    expect(exerciseGroupPlace(SUPERSET, 1).isLastExercise).toBe(true);
    expect(exerciseGroupPlace(group({}, 2), 0).roundsAreRows).toBe(false);
  });
});

describe("restAfterGroupedRow", () => {
  const first = exerciseGroupPlace(SUPERSET, 0);
  const last = exerciseGroupPlace(SUPERSET, 1);
  const after = (rows: ReturnType<typeof threeRounds>, place: Readonly<ExerciseGroupPlace>, rowCount = rows.length, ownRest = true) =>
    Array.from({ length: rowCount }, (_, i) => restAfterGroupedRow(rows, i, rowCount, place, ownRest));

  it("is a lone exercise's own rest between its sets, gated by its Rest column", () => {
    const rows = threeRounds(120);
    expect(after(rows, LONE_EXERCISE)).toEqual([0, 1, 2].map((i) => restAfterRow(rows, i)));
    expect(after(rows, LONE_EXERCISE)).toEqual([120, 120, null]);
    expect(after(rows, LONE_EXERCISE, 3, false)).toEqual([null, null, null]);
  });

  it("follows every round of an exercise but the last with the rest between exercises", () => {
    expect(after(threeRounds(), first)).toEqual([30, 30, 30]);
  });

  it("follows the last exercise's rounds with the rest between rounds, and its final round with nothing", () => {
    expect(after(threeRounds(), last)).toEqual([90, 90, null]);
  });

  it("never uses an exercise's own rest in a superset or circuit, and its Rest column gates nothing of the group's", () => {
    const noGroupRests = exerciseGroupPlace({ ...SUPERSET, restBetweenExercisesSeconds: null, restBetweenRoundsSeconds: null }, 1);
    expect(after(threeRounds(60), noGroupRests)).toEqual([null, null, null]);
    expect(after(threeRounds(60), last, 3, false)).toEqual([90, 90, null]);
  });

  it("shows no timer for a rest of 0", () => {
    const zero = exerciseGroupPlace({ ...SUPERSET, restBetweenExercisesSeconds: 0 }, 0);
    expect(after(threeRounds(), zero)).toEqual([null, null, null]);
  });

  it("never rests mid drop set, and rests after the drops that end a round", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, reps_min: 10, reps_max: 10 }),
      spec({ set_number: 2, set_type: "drop", reps_min: 10, reps_max: 10, drops: [{ load_value: 40, reps: 8 }] }),
    ]);
    // Round 1, round 2's top set, round 2's drop.
    expect(after(rows, first)).toEqual([30, null, 30]);
    expect(after(rows, last)).toEqual([90, null, null]);
  });

  it("treats a round the client added as a round", () => {
    expect(after(threeRounds(), last, 4)).toEqual([90, 90, 90, null]);
  });

  it("in a linked straight-sets group keeps the exercise's own rests and adds the rest between exercises after its last set", () => {
    const straight = group({ restBetweenExercisesSeconds: 45, restBetweenRoundsSeconds: 90 }, 2);
    const rows = threeRounds(120);
    expect(after(rows, exerciseGroupPlace(straight, 0))).toEqual([120, 120, 45]);
    expect(after(rows, exerciseGroupPlace(straight, 1))).toEqual([120, 120, null]);
    expect(after(rows, exerciseGroupPlace(straight, 0), 3, false)).toEqual([null, null, 45]);
  });
});

describe("formatRoundReps", () => {
  const rows = (reps: Array<[number | null, number | null]>, over: Partial<SetSpec> = {}) =>
    buildPrescribedRows(reps.map(([min, max], i) => spec({ set_number: i + 1, reps_min: min, reps_max: max, ...over })));

  it("reads one count when every round asks the same", () => {
    expect(formatRoundReps(rows([[10, 10], [10, 10], [10, 10]]))).toBe("10 reps");
    expect(formatRoundReps(rows([[8, 10], [8, 10]]))).toBe("8-10 reps");
  });

  it("reads a rep scheme round by round", () => {
    expect(formatRoundReps(rows([[21, 21], [15, 15], [9, 9]]))).toBe("21-15-9 reps");
  });

  it("separates ranges with a mark a range can't contain", () => {
    expect(formatRoundReps(rows([[8, 10], [6, 8]]))).toBe("8-10, 6-8 reps");
  });

  it("reads a round's rep target as written", () => {
    expect(formatRoundReps(buildPrescribedRows([spec({ set_number: 1, reps_target: "max" }), spec({ set_number: 2, reps_target: "max" })]))).toBe("max reps");
  });

  it("says nothing when a round asks no rep count", () => {
    expect(
      formatRoundReps(
        buildPrescribedRows([
          spec({ set_number: 1, reps_min: 10, reps_max: 10 }),
          spec({ set_number: 2, set_type: "amrap", reps_min: 10, reps_max: 10 }),
        ]),
      ),
    ).toBeNull();
    expect(formatRoundReps([])).toBeNull();
  });

  it("counts a drop set's round once", () => {
    expect(
      formatRoundReps(
        buildPrescribedRows([
          spec({ set_number: 1, reps_min: 10, reps_max: 10 }),
          spec({ set_number: 2, set_type: "drop", reps_min: 10, reps_max: 10, drops: [{ load_value: 40, reps: 6 }] }),
        ]),
      ),
    ).toBe("10 reps");
  });
});
