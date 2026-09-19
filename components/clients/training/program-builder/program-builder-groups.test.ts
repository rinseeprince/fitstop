import { describe, expect, it } from "vitest";
import {
  fitExerciseSets,
  groupColumnsPreset,
  hasGroupRounds,
  linkExercises,
  moveExercise,
  moveGroup,
  normalizeGroups,
  progressGroupRounds,
  rowsAreRounds,
  unlinkGroup,
  updateGroup,
  type GroupEditResult,
} from "./program-builder-groups";
import { defaultExerciseDraftFromCatalog, straightSetsGroup } from "./program-builder-model";
import type { ExerciseDraft, ExerciseGroupDraft, SessionDraft } from "./program-builder-types";
import { STRAIGHT_SETS, sessionExercises } from "@/utils/exercise-groups";
import { expandSetSpecs, setSpecCount, type SetSpec } from "@/utils/exercise-set-specs";

const exercise = (uid: string, overrides: Partial<ExerciseDraft> = {}): ExerciseDraft => ({
  ...defaultExerciseDraftFromCatalog({ name: uid, exerciseId: null, exerciseType: null }),
  uid,
  ...overrides,
});

const spec = (n: number, overrides: Partial<SetSpec> = {}): SetSpec => ({
  set_number: n,
  set_type: "working",
  reps_min: 10,
  reps_max: 10,
  ...overrides,
});

const lone = (uid: string, overrides: Partial<ExerciseDraft> = {}): ExerciseGroupDraft =>
  straightSetsGroup(`grp-${uid}`, exercise(uid, overrides));

const circuit = (
  uid: string,
  exercises: ExerciseDraft[],
  overrides: Partial<ExerciseGroupDraft> = {},
): ExerciseGroupDraft => ({
  uid,
  ...STRAIGHT_SETS,
  format: "circuit",
  rounds: 3,
  restBetweenExercisesSeconds: 30,
  restBetweenRoundsSeconds: 90,
  notes: "Back to back",
  exercises,
  ...overrides,
});

const session = (groups: ExerciseGroupDraft[]): SessionDraft => ({
  uid: "sess-1",
  name: "Hybrid",
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups,
});

const ok = (result: GroupEditResult): SessionDraft => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.session;
};
const shape = (s: SessionDraft) => s.groups.map((g) => g.exercises.map((e) => e.uid));
const order = (s: SessionDraft) => sessionExercises(s).map((e) => e.uid);

const timed = (
  uid: string,
  format: "amrap" | "emom" | "for_time",
  exercises: ExerciseDraft[],
  overrides: Partial<ExerciseGroupDraft> = {},
): ExerciseGroupDraft => ({
  uid,
  ...STRAIGHT_SETS,
  format,
  ...(format === "amrap" ? { timeCapSeconds: 720 } : { rounds: 3 }),
  ...(format === "emom" ? { intervalSeconds: 60 } : {}),
  exercises,
  ...overrides,
});

describe("rowsAreRounds and hasGroupRounds", () => {
  it("rows are rounds in a superset or circuit and in a timed group of any size; a superset, EMOM or For time has rounds, an AMRAP doesn't", () => {
    const superset = circuit("c", [exercise("a"), exercise("b")]);
    expect(rowsAreRounds(superset)).toBe(true);
    expect(hasGroupRounds(superset)).toBe(true);
    // A circuit of one is a plain exercise; linked straight sets loop nothing.
    expect(rowsAreRounds(circuit("c", [exercise("a")]))).toBe(false);
    expect(rowsAreRounds({ ...superset, format: "straight_sets" })).toBe(false);
    expect(hasGroupRounds({ ...superset, format: "straight_sets" })).toBe(false);
    const amrap = timed("t", "amrap", [exercise("a")]);
    expect(rowsAreRounds(amrap)).toBe(true);
    expect(hasGroupRounds(amrap)).toBe(false);
    expect(hasGroupRounds(timed("t", "emom", [exercise("a")]))).toBe(true);
    expect(hasGroupRounds(timed("t", "for_time", [exercise("a"), exercise("b")]))).toBe(true);
  });
});

describe("normalizeGroups", () => {
  it("drops an empty group and makes a group of one a plain exercise", () => {
    const groups = normalizeGroups([
      circuit("empty", []),
      circuit("left-alone", [exercise("a")]),
    ]);
    expect(groups).toEqual([{ uid: "left-alone", ...STRAIGHT_SETS, exercises: [exercise("a")] }]);
  });

  it("keeps no setting a format doesn't use", () => {
    const [straight, looped] = normalizeGroups([
      circuit("s", [exercise("a"), exercise("b")], {
        format: "straight_sets",
        timeCapSeconds: 600,
        intervalSeconds: 60,
      }),
      circuit("c", [exercise("c"), exercise("d")], { timeCapSeconds: 600, intervalSeconds: 60 }),
    ]);
    expect(straight).toMatchObject({
      format: "straight_sets",
      rounds: null,
      restBetweenRoundsSeconds: null,
      timeCapSeconds: null,
      intervalSeconds: null,
      restBetweenExercisesSeconds: 30,
      notes: "Back to back",
    });
    expect(looped).toMatchObject({
      rounds: 3,
      restBetweenRoundsSeconds: 90,
      timeCapSeconds: null,
      intervalSeconds: null,
    });
  });

  it("keeps a timed group of one, with only the settings its format uses", () => {
    const [amrap, emom, forTime] = normalizeGroups([
      timed("a", "amrap", [exercise("a")], { rounds: 3, intervalSeconds: 60, restBetweenExercisesSeconds: 30, notes: "Go" }),
      timed("e", "emom", [exercise("b")], { timeCapSeconds: 600, restBetweenExercisesSeconds: 30, restBetweenRoundsSeconds: 60 }),
      timed("f", "for_time", [exercise("c")], { intervalSeconds: 60, timeCapSeconds: 720, restBetweenRoundsSeconds: 60 }),
    ]);
    expect(amrap).toMatchObject({
      format: "amrap",
      timeCapSeconds: 720,
      rounds: null,
      intervalSeconds: null,
      restBetweenExercisesSeconds: null,
      notes: "Go",
    });
    expect(emom).toMatchObject({
      format: "emom",
      rounds: 3,
      intervalSeconds: 60,
      timeCapSeconds: null,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
    });
    expect(forTime).toMatchObject({
      format: "for_time",
      rounds: 3,
      timeCapSeconds: 720,
      intervalSeconds: null,
      restBetweenRoundsSeconds: 60,
    });
  });
});

describe("fitExerciseSets", () => {
  it("adds copies of the last set, and removes the last sets", () => {
    const withSpecs = exercise("a", { setSpecs: [spec(1, { reps_min: 21, reps_max: 21 }), spec(2)] });
    const grown = fitExerciseSets(withSpecs, 4);
    if (!grown.ok) throw new Error(grown.reason);
    expect(grown.exercise.setSpecs?.map((s) => [s.set_number, s.reps_min])).toEqual([
      [1, 21],
      [2, 10],
      [3, 10],
      [4, 10],
    ]);
    expect(grown.exercise.sets).toBe(4);

    const shrunk = fitExerciseSets(grown.exercise, 1);
    if (!shrunk.ok) throw new Error(shrunk.reason);
    expect(shrunk.exercise.setSpecs?.map((s) => s.reps_min)).toEqual([21]);
  });

  it("returns the same exercise when it already has that many sets", () => {
    const compact = exercise("a", { sets: 3 });
    const result = fitExerciseSets(compact, 3);
    expect(result.ok && result.exercise).toBe(compact);
  });

  it("refuses to leave an exercise with only warm-ups, and a count outside 1-30", () => {
    const warmupsFirst = exercise("a", {
      setSpecs: [spec(1, { set_type: "warmup" }), spec(2)],
    });
    expect(fitExerciseSets(warmupsFirst, 1)).toEqual({
      ok: false,
      reason: "a: At least one working set is required",
    });
    expect(fitExerciseSets(exercise("a"), 0).ok).toBe(false);
    expect(fitExerciseSets(exercise("a"), 31).ok).toBe(false);
  });
});

describe("linkExercises", () => {
  it("makes a new superset where the first picked exercise was, in session order", () => {
    const s = session([lone("a"), lone("b"), lone("c"), lone("d")]);
    const linked = ok(linkExercises(s, ["d", "b"], "grp-new"));
    expect(shape(linked)).toEqual([["a"], ["b", "d"], ["c"]]);
    expect(linked.groups[1]).toMatchObject({
      uid: "grp-new",
      format: "circuit",
      rounds: 3,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
      notes: null,
    });
  });

  it("takes the rounds of the exercise with the most sets and gives the others copies of their last set", () => {
    const s = session([lone("a", { sets: 3 }), lone("b", { sets: 5 })]);
    const linked = ok(linkExercises(s, ["a", "b"], "grp-new"));
    expect(linked.groups[0].rounds).toBe(5);
    expect(linked.groups[0].exercises.map(setSpecCount)).toEqual([5, 5]);
  });

  it("takes an exercise out of its old group; a group left with one becomes a plain exercise", () => {
    const s = session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("x")]);
    const linked = ok(linkExercises(s, ["b", "x"], "grp-new"));
    expect(shape(linked)).toEqual([["a"], ["b", "x"]]);
    expect(linked.groups[0]).toEqual({ uid: "grp-c", ...STRAIGHT_SETS, exercises: [exercise("a")] });
  });

  it("follows the exercises before the first picked one in its group", () => {
    const s = session([circuit("grp-c", [exercise("a"), exercise("b"), exercise("c")]), lone("x")]);
    const linked = ok(linkExercises(s, ["b", "x"], "grp-new"));
    expect(shape(linked)).toEqual([["a", "c"], ["b", "x"]]);
  });

  it("takes the whole group's place when every exercise of it is picked", () => {
    const s = session([lone("x"), circuit("grp-c", [exercise("a"), exercise("b")]), lone("y")]);
    const linked = ok(linkExercises(s, ["a", "b", "y"], "grp-new"));
    expect(shape(linked)).toEqual([["x"], ["a", "b", "y"]]);
    expect(linked.groups.map((g) => g.uid)).toEqual(["grp-x", "grp-new"]);
  });

  it("refuses fewer than two exercises for a superset, and one that no longer exists", () => {
    const s = session([lone("a"), lone("b")]);
    expect(linkExercises(s, ["a"], "g").ok).toBe(false);
    expect(linkExercises(s, ["a", "gone"], "g").ok).toBe(false);
    expect(linkExercises(s, [], "g", "amrap").ok).toBe(false);
  });

  it("makes an AMRAP from one exercise or more, each fitted to one row, with a 10-minute cap", () => {
    const s = session([lone("a", { sets: 3 }), lone("b", { sets: 4 }), lone("c")]);
    const one = ok(linkExercises(s, ["a"], "grp-new", "amrap"));
    expect(shape(one)).toEqual([["a"], ["b"], ["c"]]);
    expect(one.groups[0]).toMatchObject({
      uid: "grp-new",
      format: "amrap",
      timeCapSeconds: 600,
      rounds: null,
      intervalSeconds: null,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
    });
    expect(one.groups[0].exercises.map(setSpecCount)).toEqual([1]);

    const two = ok(linkExercises(s, ["a", "b"], "grp-new", "amrap"));
    expect(shape(two)).toEqual([["a", "b"], ["c"]]);
    expect(two.groups[0].exercises.map(setSpecCount)).toEqual([1, 1]);
  });

  it("makes an EMOM at every minute and a For time with no cap, each with the most sets as rounds", () => {
    const s = session([lone("a", { sets: 3 }), lone("b", { sets: 5 })]);
    const emom = ok(linkExercises(s, ["a"], "grp-new", "emom"));
    expect(emom.groups[0]).toMatchObject({ format: "emom", rounds: 3, intervalSeconds: 60, timeCapSeconds: null });
    const forTime = ok(linkExercises(s, ["a", "b"], "grp-new", "for_time"));
    expect(forTime.groups[0]).toMatchObject({ format: "for_time", rounds: 5, timeCapSeconds: null, intervalSeconds: null });
    expect(forTime.groups[0].exercises.map(setSpecCount)).toEqual([5, 5]);
  });
});

describe("unlinkGroup", () => {
  it("makes every exercise a plain exercise in the same place, keeping its sets", () => {
    const s = session([
      lone("x"),
      circuit("grp-c", [exercise("a", { sets: 4 }), exercise("b", { sets: 4 })], { rounds: 4 }),
      lone("y"),
    ]);
    const unlinked = ok(unlinkGroup(s, "grp-c", ["g1", "g2"]));
    expect(shape(unlinked)).toEqual([["x"], ["a"], ["b"], ["y"]]);
    expect(unlinked.groups.slice(1, 3)).toEqual([
      { uid: "g1", ...STRAIGHT_SETS, exercises: [exercise("a", { sets: 4 })] },
      { uid: "g2", ...STRAIGHT_SETS, exercises: [exercise("b", { sets: 4 })] },
    ]);
  });

  it("leaves a lone exercise as it is and refuses a group that no longer exists", () => {
    const s = session([lone("a")]);
    expect(ok(unlinkGroup(s, "grp-a", ["g"]))).toBe(s);
    expect(unlinkGroup(s, "gone", []).ok).toBe(false);
  });

  it("returns a timed group of one to a plain exercise, in place", () => {
    const s = session([lone("x"), timed("grp-t", "amrap", [exercise("a", { sets: 1 })])]);
    const unlinked = ok(unlinkGroup(s, "grp-t", ["g"]));
    expect(shape(unlinked)).toEqual([["x"], ["a"]]);
    expect(unlinked.groups[1]).toEqual({ uid: "grp-t", ...STRAIGHT_SETS, exercises: [exercise("a", { sets: 1 })] });
  });
});

describe("moveExercise", () => {
  it("moves a standalone exercise among the session's groups, counting places before the move", () => {
    const s = session([lone("a"), circuit("grp-c", [exercise("b"), exercise("c")]), lone("d")]);
    expect(shape(ok(moveExercise(s, "a", { kind: "session", index: 2 }, "g")))).toEqual([
      ["b", "c"],
      ["a"],
      ["d"],
    ]);
    expect(shape(ok(moveExercise(s, "d", { kind: "session", index: 0 }, "g")))).toEqual([
      ["d"],
      ["a"],
      ["b", "c"],
    ]);
    // A standalone exercise keeps its own group.
    expect(ok(moveExercise(s, "d", { kind: "session", index: 0 }, "g")).groups[0].uid).toBe("grp-d");
  });

  it("returns the same session when an exercise lands where it is", () => {
    const s = session([lone("a"), lone("b"), circuit("grp-c", [exercise("c"), exercise("d")])]);
    expect(ok(moveExercise(s, "a", { kind: "session", index: 0 }, "g"))).toBe(s);
    expect(ok(moveExercise(s, "a", { kind: "session", index: 1 }, "g"))).toBe(s);
    expect(ok(moveExercise(s, "c", { kind: "group", groupUid: "grp-c", index: 0 }, "g"))).toBe(s);
    expect(ok(moveExercise(s, "c", { kind: "group", groupUid: "grp-c", index: 1 }, "g"))).toBe(s);
  });

  it("reorders within its own group", () => {
    const s = session([circuit("grp-c", [exercise("a"), exercise("b"), exercise("c")])]);
    expect(shape(ok(moveExercise(s, "a", { kind: "group", groupUid: "grp-c", index: 3 }, "g")))).toEqual([
      ["b", "c", "a"],
    ]);
    expect(shape(ok(moveExercise(s, "c", { kind: "group", groupUid: "grp-c", index: 0 }, "g")))).toEqual([
      ["c", "a", "b"],
    ]);
  });

  it("joins a superset or circuit and takes its rounds", () => {
    const s = session([
      circuit("grp-c", [exercise("a", { sets: 3 }), exercise("b", { sets: 3 })]),
      lone("x", { sets: 2 }),
      lone("y", { sets: 5 }),
    ]);
    const grown = ok(moveExercise(s, "x", { kind: "group", groupUid: "grp-c", index: 1 }, "g"));
    expect(shape(grown)).toEqual([["a", "x", "b"], ["y"]]);
    expect(grown.groups[0].exercises.map(setSpecCount)).toEqual([3, 3, 3]);
    expect(grown.groups[0]).toMatchObject({ rounds: 3, restBetweenRoundsSeconds: 90 });

    const trimmed = ok(moveExercise(s, "y", { kind: "group", groupUid: "grp-c", index: 2 }, "g"));
    expect(trimmed.groups[0].exercises.map(setSpecCount)).toEqual([3, 3, 3]);
  });

  it("keeps its sets when it joins linked straight sets", () => {
    const s = session([
      circuit("grp-s", [exercise("a", { sets: 3 }), exercise("b", { sets: 3 })], { format: "straight_sets", rounds: null }),
      lone("x", { sets: 5 }),
    ]);
    const joined = ok(moveExercise(s, "x", { kind: "group", groupUid: "grp-s", index: 2 }, "g"));
    expect(joined.groups[0].exercises.map(setSpecCount)).toEqual([3, 3, 5]);
  });

  it("stands alone in a new group when it leaves a linked group; a group left with one becomes plain", () => {
    const s = session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("x")]);
    const out = ok(moveExercise(s, "a", { kind: "session", index: 2 }, "grp-new"));
    expect(shape(out)).toEqual([["b"], ["x"], ["a"]]);
    expect(out.groups[2]).toEqual({ uid: "grp-new", ...STRAIGHT_SETS, exercises: [exercise("a")] });
    expect(out.groups[0]).toEqual({ uid: "grp-c", ...STRAIGHT_SETS, exercises: [exercise("b")] });
  });

  it("moves between two linked groups", () => {
    const s = session([
      circuit("grp-1", [exercise("a"), exercise("b"), exercise("c")]),
      circuit("grp-2", [exercise("d"), exercise("e")], { rounds: 3 }),
    ]);
    const moved = ok(moveExercise(s, "c", { kind: "group", groupUid: "grp-2", index: 0 }, "g"));
    expect(shape(moved)).toEqual([["a", "b"], ["c", "d", "e"]]);
  });

  it("joins a timed group of one: fitted to one row in an AMRAP, to the rounds of a For time", () => {
    const s = session([
      timed("grp-a", "amrap", [exercise("a", { sets: 1 })]),
      timed("grp-f", "for_time", [exercise("f", { sets: 3 })]),
      lone("x", { sets: 4 }),
      lone("y", { sets: 5 }),
    ]);
    const amrap = ok(moveExercise(s, "x", { kind: "group", groupUid: "grp-a", index: 1 }, "g"));
    expect(shape(amrap)).toEqual([["a", "x"], ["f"], ["y"]]);
    expect(amrap.groups[0].exercises.map(setSpecCount)).toEqual([1, 1]);
    const forTime = ok(moveExercise(s, "y", { kind: "group", groupUid: "grp-f", index: 0 }, "g"));
    expect(shape(forTime)).toEqual([["a"], ["y", "f"], ["x"]]);
    expect(forTime.groups[1].exercises.map(setSpecCount)).toEqual([3, 3]);
  });

  it("refuses a target that isn't a linked group, and a fit that would leave only warm-ups", () => {
    const s = session([
      lone("a"),
      lone("b"),
      circuit("grp-c", [exercise("c", { sets: 1 }), exercise("d", { sets: 1 })], { rounds: 1 }),
      lone("w", { setSpecs: [spec(1, { set_type: "warmup" }), spec(2)] }),
    ]);
    expect(moveExercise(s, "a", { kind: "group", groupUid: "grp-b", index: 0 }, "g").ok).toBe(false);
    expect(moveExercise(s, "a", { kind: "group", groupUid: "gone", index: 0 }, "g").ok).toBe(false);
    expect(moveExercise(s, "w", { kind: "group", groupUid: "grp-c", index: 0 }, "g")).toEqual({
      ok: false,
      reason: "w: At least one working set is required",
    });
    expect(moveExercise(s, "gone", { kind: "session", index: 0 }, "g").ok).toBe(false);
  });
});

describe("moveGroup", () => {
  it("moves a whole group, counting places before the move, and is the same session in place", () => {
    const s = session([lone("a"), circuit("grp-c", [exercise("b"), exercise("c")]), lone("d")]);
    expect(order(ok(moveGroup(s, "grp-c", 0)))).toEqual(["b", "c", "a", "d"]);
    expect(order(ok(moveGroup(s, "grp-c", 3)))).toEqual(["a", "d", "b", "c"]);
    expect(ok(moveGroup(s, "grp-c", 1))).toBe(s);
    expect(ok(moveGroup(s, "grp-c", 2))).toBe(s);
    expect(moveGroup(s, "gone", 0).ok).toBe(false);
  });
});

describe("updateGroup", () => {
  const superset = () =>
    session([
      circuit("grp-c", [
        exercise("a", { setSpecs: [spec(1, { reps_min: 21, reps_max: 21 }), spec(2, { reps_min: 15, reps_max: 15 }), spec(3, { reps_min: 9, reps_max: 9 })] }),
        exercise("b", { sets: 3 }),
      ]),
    ]);

  it("changes rounds on every exercise together, adding copies of the last round or removing the last", () => {
    const more = ok(updateGroup(superset(), "grp-c", { rounds: 4 }));
    expect(more.groups[0].rounds).toBe(4);
    expect(more.groups[0].exercises.map(setSpecCount)).toEqual([4, 4]);
    expect(expandSetSpecs(more.groups[0].exercises[0]).map((s) => s.reps_min)).toEqual([21, 15, 9, 9]);

    const fewer = ok(updateGroup(superset(), "grp-c", { rounds: 2 }));
    expect(fewer.groups[0].exercises.map(setSpecCount)).toEqual([2, 2]);
    expect(expandSetSpecs(fewer.groups[0].exercises[0]).map((s) => s.reps_min)).toEqual([21, 15]);
  });

  it("switches to straight sets keeping every set, and back to a superset taking the most sets", () => {
    const straight = ok(updateGroup(superset(), "grp-c", { format: "straight_sets" }));
    expect(straight.groups[0]).toMatchObject({
      format: "straight_sets",
      rounds: null,
      restBetweenRoundsSeconds: null,
      restBetweenExercisesSeconds: 30,
      notes: "Back to back",
    });
    expect(straight.groups[0].exercises.map(setSpecCount)).toEqual([3, 3]);

    const uneven = session([
      circuit("grp-s", [exercise("a", { sets: 2 }), exercise("b", { sets: 4 })], {
        format: "straight_sets",
        rounds: null,
        restBetweenRoundsSeconds: null,
      }),
    ]);
    const looped = ok(updateGroup(uneven, "grp-s", { format: "circuit" }));
    expect(looped.groups[0].rounds).toBe(4);
    expect(looped.groups[0].exercises.map(setSpecCount)).toEqual([4, 4]);
  });

  it("sets and clears rests and notes", () => {
    const changed = ok(
      updateGroup(superset(), "grp-c", {
        restBetweenExercisesSeconds: 0,
        restBetweenRoundsSeconds: null,
        notes: null,
      }),
    );
    expect(changed.groups[0]).toMatchObject({
      restBetweenExercisesSeconds: 0,
      restBetweenRoundsSeconds: null,
      notes: null,
    });
  });

  it("returns the same session when nothing changes", () => {
    const s = superset();
    expect(ok(updateGroup(s, "grp-c", { rounds: 3, notes: "Back to back" }))).toBe(s);
    expect(ok(updateGroup(s, "grp-c", {}))).toBe(s);
  });

  it("switches to a timed format, keeping the settings it uses and fitting every exercise's rows", () => {
    const amrap = ok(updateGroup(superset(), "grp-c", { format: "amrap" }));
    expect(amrap.groups[0]).toMatchObject({
      format: "amrap",
      timeCapSeconds: 600,
      rounds: null,
      intervalSeconds: null,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
      notes: "Back to back",
    });
    expect(amrap.groups[0].exercises.map(setSpecCount)).toEqual([1, 1]);
    // The first round's targets are what the one row keeps.
    expect(expandSetSpecs(amrap.groups[0].exercises[0]).map((s) => s.reps_min)).toEqual([21]);

    const emom = ok(updateGroup(superset(), "grp-c", { format: "emom", intervalSeconds: 90 }));
    expect(emom.groups[0]).toMatchObject({
      format: "emom",
      rounds: 3,
      intervalSeconds: 90,
      timeCapSeconds: null,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
    });
    expect(ok(updateGroup(superset(), "grp-c", { format: "emom" })).groups[0].intervalSeconds).toBe(60);

    const forTime = ok(updateGroup(superset(), "grp-c", { format: "for_time", timeCapSeconds: 720 }));
    expect(forTime.groups[0]).toMatchObject({
      format: "for_time",
      rounds: 3,
      timeCapSeconds: 720,
      intervalSeconds: null,
      restBetweenExercisesSeconds: 30,
      restBetweenRoundsSeconds: 90,
    });
    // A For time's cap is optional; an AMRAP's is what it is.
    expect(ok(updateGroup(forTime, "grp-c", { timeCapSeconds: null })).groups[0].timeCapSeconds).toBeNull();
    expect(ok(updateGroup(amrap, "grp-c", { timeCapSeconds: null })).groups[0].timeCapSeconds).toBe(600);

    // Back to a superset from a For time keeps the rounds; from an AMRAP it
    // takes the most sets, one.
    expect(ok(updateGroup(forTime, "grp-c", { format: "circuit" })).groups[0].rounds).toBe(3);
    expect(ok(updateGroup(amrap, "grp-c", { format: "circuit" })).groups[0].rounds).toBe(1);
  });

  it("edits a timed group of one, and returns it to a plain exercise on straight sets", () => {
    const s = session([timed("grp-t", "emom", [exercise("a", { sets: 6 })], { rounds: 6 })]);
    const changed = ok(updateGroup(s, "grp-t", { rounds: 8, intervalSeconds: 120, notes: "Every two minutes" }));
    expect(changed.groups[0]).toMatchObject({ rounds: 8, intervalSeconds: 120, notes: "Every two minutes" });
    expect(changed.groups[0].exercises.map(setSpecCount)).toEqual([8]);
    expect(updateGroup(s, "grp-t", { format: "circuit" }).ok).toBe(false);
    const plain = ok(updateGroup(s, "grp-t", { format: "straight_sets" }));
    expect(plain.groups[0]).toEqual({ uid: "grp-t", ...STRAIGHT_SETS, exercises: [exercise("a", { sets: 6 })] });
  });

  it("refuses a setting a timed format doesn't use, and a clock outside its bounds", () => {
    const amrap = session([timed("grp-a", "amrap", [exercise("a", { sets: 1 })])]);
    expect(updateGroup(amrap, "grp-a", { rounds: 3 })).toEqual({ ok: false, reason: "An AMRAP has no rounds, interval or rests" });
    expect(updateGroup(amrap, "grp-a", { restBetweenExercisesSeconds: 30 }).ok).toBe(false);
    expect(updateGroup(amrap, "grp-a", { timeCapSeconds: 14_401 }).ok).toBe(false);
    const emom = session([timed("grp-e", "emom", [exercise("a")])]);
    expect(updateGroup(emom, "grp-e", { timeCapSeconds: 600 })).toEqual({ ok: false, reason: "An EMOM has no time cap or rests" });
    expect(updateGroup(emom, "grp-e", { intervalSeconds: 3_601 }).ok).toBe(false);
    const forTime = session([timed("grp-f", "for_time", [exercise("a")])]);
    expect(updateGroup(forTime, "grp-f", { intervalSeconds: 60 })).toEqual({ ok: false, reason: "A For time has no interval" });
  });

  it("refuses what doesn't apply or can't hold", () => {
    const s = superset();
    expect(updateGroup(s, "grp-c", { format: "straight_sets", rounds: 3 }).ok).toBe(false);
    expect(updateGroup(s, "grp-c", { rounds: 0 }).ok).toBe(false);
    expect(updateGroup(s, "grp-c", { rounds: 31 }).ok).toBe(false);
    expect(updateGroup(s, "grp-c", { restBetweenExercisesSeconds: 3601 }).ok).toBe(false);
    expect(updateGroup(s, "grp-c", { notes: "x".repeat(1001) }).ok).toBe(false);
    expect(updateGroup(session([lone("a")]), "grp-a", { notes: "x" }).ok).toBe(false);
    expect(updateGroup(s, "gone", { rounds: 2 }).ok).toBe(false);
  });
});

describe("progressGroupRounds", () => {
  const group = (exercises: ExerciseDraft[], rounds = 3) => circuit("grp-c", exercises, { rounds });

  it("adds rounds to every exercise, copying its last set", () => {
    const next = progressGroupRounds(group([exercise("a", { sets: 3 }), exercise("b", { sets: 3 })]), 2);
    expect(next?.rounds).toBe(5);
    expect(next?.exercises.map(setSpecCount)).toEqual([5, 5]);
  });

  it("removes rounds from the end and keeps one round with a working set on every exercise", () => {
    const next = progressGroupRounds(group([exercise("a", { sets: 3 }), exercise("b", { sets: 3 })]), -5);
    expect(next?.rounds).toBe(1);

    const warmupFirst = group([
      exercise("a", { setSpecs: [spec(1, { set_type: "warmup" }), spec(2), spec(3)] }),
      exercise("b", { sets: 3 }),
    ]);
    expect(progressGroupRounds(warmupFirst, -2)?.rounds).toBe(2);
  });

  it("stops where an exercise would pass 20 working sets", () => {
    const next = progressGroupRounds(group([exercise("a", { sets: 19 }), exercise("b", { sets: 19 })], 19), 5);
    expect(next?.rounds).toBe(20);
    expect(progressGroupRounds(group([exercise("a", { sets: 20 }), exercise("b", { sets: 20 })], 20), 1)).toBeNull();
  });

  it("adds rounds to an EMOM and a For time, and never changes an AMRAP's one row", () => {
    const emom = progressGroupRounds(timed("e", "emom", [exercise("a", { sets: 3 })]), 2);
    expect(emom?.rounds).toBe(5);
    expect(emom?.exercises.map(setSpecCount)).toEqual([5]);
    const forTime = progressGroupRounds(timed("f", "for_time", [exercise("a", { sets: 3 }), exercise("b", { sets: 3 })]), -1);
    expect(forTime?.rounds).toBe(2);
    expect(progressGroupRounds(timed("a", "amrap", [exercise("a", { sets: 1 })]), 1)).toBeNull();
  });

  it("changes nothing for a zero amount, a lone exercise or linked straight sets", () => {
    expect(progressGroupRounds(group([exercise("a"), exercise("b")]), 0)).toBeNull();
    expect(progressGroupRounds(group([exercise("a")]), 1)).toBeNull();
    expect(
      progressGroupRounds({ ...group([exercise("a"), exercise("b")]), format: "straight_sets" }, 1),
    ).toBeNull();
  });
});

describe("updateGroup — a column preset for every exercise in the group", () => {
  const superset = () =>
    session([
      circuit("grp-c", [
        exercise("a", { prescribedFields: ["set_type", "reps", "load", "rpe", "rest"] }),
        exercise("b", { prescribedFields: ["set_type", "reps", "load", "rpe"] }),
      ]),
    ]);

  it("sets every exercise to the preset, each keeping its own Rest choice in a superset or circuit", () => {
    const next = ok(updateGroup(superset(), "grp-c", { columnsPreset: "circuit" }));
    expect(next.groups[0].exercises.map((e) => e.prescribedFields)).toEqual([
      ["reps", "load", "rest"],
      ["reps", "load"],
    ]);
    // The group's own settings are untouched.
    expect(next.groups[0]).toMatchObject({ format: "circuit", rounds: 3, notes: "Back to back" });
  });

  it("applies Rest as the preset says once the rows aren't rounds — a preset with a switch to straight sets", () => {
    const next = ok(updateGroup(superset(), "grp-c", { format: "straight_sets", columnsPreset: "circuit" }));
    expect(next.groups[0].exercises.map((e) => e.prescribedFields)).toEqual([
      ["reps", "load"],
      ["reps", "load"],
    ]);
  });

  it("is the same session when every exercise already has the preset's columns", () => {
    const s = session([
      circuit("grp-c", [
        exercise("a", { prescribedFields: ["set_type", "distance", "duration", "pace", "heart_rate_zone", "rest"] }),
        exercise("b", { prescribedFields: ["set_type", "distance", "duration", "pace", "heart_rate_zone"] }),
      ]),
    ]);
    expect(ok(updateGroup(s, "grp-c", { columnsPreset: "endurance" }))).toBe(s);
  });

  it("a lone exercise has no group settings, its preset included", () => {
    const s = session([lone("a")]);
    expect(updateGroup(s, "grp-a", { columnsPreset: "erg" }).ok).toBe(false);
  });
});

describe("groupColumnsPreset — what the group heading's Columns menu ticks", () => {
  it("is the preset every exercise is on, a hidden Rest ignored in a superset or circuit", () => {
    const both = circuit("grp-c", [
      exercise("a", { prescribedFields: ["reps", "load", "rest"] }),
      exercise("b", { prescribedFields: ["reps", "load"] }),
    ]);
    expect(groupColumnsPreset(both)).toBe("circuit");
    expect(groupColumnsPreset(ok(updateGroup(session([both]), "grp-c", { columnsPreset: "erg" })).groups[0])).toBe("erg");
  });

  it("is null when the exercises differ or one is on no preset", () => {
    expect(
      groupColumnsPreset(
        circuit("grp-c", [
          exercise("a", { prescribedFields: ["reps", "load"] }),
          exercise("b", { prescribedFields: ["set_type", "reps", "load", "rpe"] }),
        ]),
      ),
    ).toBeNull();
    expect(
      groupColumnsPreset(
        circuit("grp-c", [exercise("a", { prescribedFields: ["reps"] }), exercise("b", { prescribedFields: ["reps"] })]),
      ),
    ).toBeNull();
  });
});
