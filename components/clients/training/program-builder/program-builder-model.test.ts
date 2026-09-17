import { describe, expect, it } from "vitest";
import {
  cloneWeek,
  defaultExerciseDraftFromCatalog,
  mapSessionExercises,
  normalizeDraft,
  progressWeek,
  removeSessionExercise,
  straightSetsGroup,
} from "./program-builder-model";
import {
  makeRestSlot,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import { STRAIGHT_SETS, sessionExercises } from "@/utils/exercise-groups";
import { setSpecCount } from "@/utils/exercise-set-specs";

const exercise = (uid: string, overrides: Partial<ExerciseDraft> = {}): ExerciseDraft => ({
  ...defaultExerciseDraftFromCatalog({ name: uid, exerciseId: null }),
  uid,
  ...overrides,
});

const lone = (uid: string): ExerciseGroupDraft => straightSetsGroup(`grp-${uid}`, exercise(uid));

const circuit = (uid: string, exercises: ExerciseDraft[]): ExerciseGroupDraft => ({
  uid,
  format: "circuit",
  rounds: 3,
  timeCapSeconds: null,
  intervalSeconds: null,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 90,
  notes: "A",
  exercises,
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

const order = (s: SessionDraft) => sessionExercises(s).map((e) => e.uid);

function weekOf(s: SessionDraft): WeekDraft {
  return {
    uid: "wk-1",
    weekIndex: 0,
    days: [
      { uid: "slot-0", orderIndex: 0, isRest: false, session: s },
      ...Array.from({ length: 6 }, (_, i) => makeRestSlot(i + 1)),
    ],
  };
}

describe("straightSetsGroup", () => {
  it("is a lone exercise: straight sets, nothing else set, holding just the exercise", () => {
    const ex = exercise("ex-1");
    expect(straightSetsGroup("grp-1", ex)).toEqual({ uid: "grp-1", ...STRAIGHT_SETS, exercises: [ex] });
  });
});

describe("normalizeDraft", () => {
  it("drops a group left with no exercises and keeps every other group's settings", () => {
    const draft: ProgramDraft = {
      id: "p",
      name: "P",
      description: null,
      status: "draft",
      splitType: null,
      programDurationWeeks: 1,
      defaultSurplusPercentage: null,
      weeks: [weekOf(session([{ ...lone("gone"), exercises: [] }, circuit("grp-c", [exercise("a"), exercise("b")])]))],
    };
    const normalized = normalizeDraft(draft).weeks[0].days[0].session!;
    expect(normalized.groups).toHaveLength(1);
    expect(normalized.groups[0]).toMatchObject({ uid: "grp-c", format: "circuit", rounds: 3, notes: "A" });
  });

  it("makes a group of one a plain exercise with nothing set", () => {
    const draft: ProgramDraft = {
      id: "p",
      name: "P",
      description: null,
      status: "draft",
      splitType: null,
      programDurationWeeks: 1,
      defaultSurplusPercentage: null,
      weeks: [weekOf(session([circuit("grp-c", [exercise("a")])]))],
    };
    expect(normalizeDraft(draft).weeks[0].days[0].session!.groups).toEqual([
      { uid: "grp-c", ...STRAIGHT_SETS, exercises: [exercise("a")] },
    ]);
  });
});

describe("cloneWeek", () => {
  it("gives every group and exercise a fresh uid and keeps every setting and order", () => {
    const source = weekOf(session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("c")]));
    const copy = cloneWeek(source).days[0].session!;
    const original = source.days[0].session!;
    expect(copy.groups.map((g) => g.uid)).not.toContain("grp-c");
    expect(copy.groups.every((g) => g.uid.startsWith("grp-"))).toBe(true);
    expect(sessionExercises(copy).some((e) => ["a", "b", "c"].includes(e.uid))).toBe(false);
    const settings = (s: SessionDraft) =>
      s.groups.map(({ uid: _uid, exercises, ...rest }) => ({ ...rest, names: exercises.map((e) => e.name) }));
    expect(settings(copy)).toEqual(settings(original));
  });
});

describe("progressWeek", () => {
  it("adds a round to a whole superset or circuit when any exercise in it is in scope", () => {
    const week = weekOf(
      session([circuit("grp-c", [exercise("a", { sets: 3 }), exercise("b", { sets: 3 })]), lone("c")]),
    );
    const { week: next, changedExerciseUids } = progressWeek(
      week,
      { kind: "sets", amount: 1 },
      (e) => e.uid === "b",
    );
    const s = next.days[0].session!;
    expect([...changedExerciseUids].sort()).toEqual(["a", "b"]);
    expect(s.groups[0]).toMatchObject({ uid: "grp-c", format: "circuit", rounds: 4, restBetweenRoundsSeconds: 90 });
    expect(s.groups[0].exercises.map(setSpecCount)).toEqual([4, 4]);
    // The group nothing changed in keeps its reference.
    expect(s.groups[1]).toBe(week.days[0].session!.groups[1]);
  });

  it("leaves a superset or circuit none of whose exercises is in scope", () => {
    const week = weekOf(session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("c")]));
    const { week: next, changedExerciseUids } = progressWeek(
      week,
      { kind: "sets", amount: 1 },
      (e) => e.uid === "c",
    );
    expect([...changedExerciseUids]).toEqual(["c"]);
    expect(next.days[0].session!.groups[0]).toBe(week.days[0].session!.groups[0]);
  });

  it("progresses load and reps round by round, exercise by exercise, inside a group", () => {
    const week = weekOf(
      session([circuit("grp-c", [exercise("a", { sets: 3 }), exercise("b", { sets: 3 })])]),
    );
    const { week: next, changedExerciseUids } = progressWeek(
      week,
      { kind: "reps", amount: 1 },
      (e) => e.uid === "a",
    );
    const [a, b] = next.days[0].session!.groups[0].exercises;
    expect([...changedExerciseUids]).toEqual(["a"]);
    expect(a.repsMin).toBe(9);
    expect(setSpecCount(a)).toBe(3);
    expect(b).toBe(week.days[0].session!.groups[0].exercises[1]);
  });

  it("returns the same week when the rule changes nothing", () => {
    const week = weekOf(session([lone("a")]));
    expect(progressWeek(week, { kind: "sets", amount: 1 }, () => false).week).toBe(week);
  });
});

describe("mapSessionExercises", () => {
  it("returns the same session when nothing changes", () => {
    const s = session([lone("a"), circuit("grp-c", [exercise("b"), exercise("c")])]);
    expect(mapSessionExercises(s, (e) => e)).toBe(s);
  });
});

describe("removeSessionExercise", () => {
  it("removes a lone exercise's group with it", () => {
    const s = removeSessionExercise(session([lone("a"), lone("b")]), "a");
    expect(s.groups.map((g) => g.uid)).toEqual(["grp-b"]);
  });

  it("keeps a group that still holds an exercise, settings and all", () => {
    const s = removeSessionExercise(session([circuit("grp-c", [exercise("a"), exercise("b")])]), "b");
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]).toMatchObject({ uid: "grp-c", format: "circuit", rounds: 3, notes: "A" });
    expect(order(s)).toEqual(["a"]);
  });

  it("returns the same session when the exercise is not there", () => {
    const s = session([lone("a")]);
    expect(removeSessionExercise(s, "zzz")).toBe(s);
  });
});
