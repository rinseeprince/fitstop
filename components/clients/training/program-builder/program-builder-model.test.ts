import { describe, expect, it } from "vitest";
import {
  cloneWeek,
  defaultExerciseDraftFromCatalog,
  mapSessionExercises,
  moveSessionExercise,
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
const groupShape = (s: SessionDraft) => s.groups.map((g) => g.exercises.map((e) => e.uid));

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
  it("progresses exercises inside a group and keeps the group's uid and settings", () => {
    const week = weekOf(
      session([circuit("grp-c", [exercise("a", { sets: 3 }), exercise("b", { sets: 3 })]), lone("c")]),
    );
    const { week: next, changedExerciseUids } = progressWeek(
      week,
      { kind: "sets", amount: 1 },
      (e) => e.uid === "b",
    );
    const s = next.days[0].session!;
    expect([...changedExerciseUids]).toEqual(["b"]);
    expect(s.groups[0]).toMatchObject({ uid: "grp-c", format: "circuit", rounds: 3, restBetweenRoundsSeconds: 90 });
    expect(s.groups[0].exercises.map((e) => e.sets)).toEqual([3, 4]);
    // The group nothing changed in keeps its reference.
    expect(s.groups[1]).toBe(week.days[0].session!.groups[1]);
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

describe("moveSessionExercise", () => {
  const arrayMove = (items: string[], from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  it("moves lone exercises exactly as an array move does, for every from and to", () => {
    const uids = ["a", "b", "c", "d"];
    for (let from = 0; from < uids.length; from++) {
      for (let to = 0; to < uids.length; to++) {
        const s = session(uids.map(lone));
        const moved = moveSessionExercise(s, uids[from], to);
        expect(order(moved)).toEqual(arrayMove(uids, from, to));
        if (from === to) expect(moved).toBe(s);
      }
    }
  });

  it("moves an exercise that shares its group within that group only", () => {
    const s = session([lone("x"), circuit("grp-c", [exercise("a"), exercise("b"), exercise("c")])]);
    const moved = moveSessionExercise(s, "c", 1);
    expect(groupShape(moved)).toEqual([["x"], ["c", "a", "b"]]);
    expect(moved.groups[1]).toMatchObject({ uid: "grp-c", format: "circuit" });
    // A target outside the group clamps to its edge — never out of it.
    expect(groupShape(moveSessionExercise(s, "a", 0))).toEqual([["x"], ["a", "b", "c"]]);
    expect(groupShape(moveSessionExercise(s, "a", 3))).toEqual([["x"], ["b", "c", "a"]]);
  });

  it("never lands a lone exercise inside another group: it goes to the first group boundary at or after the target", () => {
    const after = session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("x")]);
    // Position 1 is inside the circuit; the boundary at or after it is the circuit's end.
    expect(groupShape(moveSessionExercise(after, "x", 1))).toEqual([["a", "b"], ["x"]]);
    expect(moveSessionExercise(after, "x", 1)).toBe(after);
    expect(groupShape(moveSessionExercise(after, "x", 0))).toEqual([["x"], ["a", "b"]]);

    const before = session([lone("x"), circuit("grp-c", [exercise("a"), exercise("b")])]);
    expect(groupShape(moveSessionExercise(before, "x", 1))).toEqual([["a", "b"], ["x"]]);
    expect(groupShape(moveSessionExercise(before, "x", 2))).toEqual([["a", "b"], ["x"]]);
  });

  it("clamps the target to the session and returns the same session for an absent exercise", () => {
    const s = session([lone("a"), lone("b")]);
    expect(order(moveSessionExercise(s, "a", 99))).toEqual(["b", "a"]);
    expect(order(moveSessionExercise(s, "b", -5))).toEqual(["b", "a"]);
    expect(moveSessionExercise(s, "zzz", 0)).toBe(s);
  });
});
