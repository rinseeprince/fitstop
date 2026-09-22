import { describe, expect, it } from "vitest";
import {
  DAY_IS_FULL,
  addSessionToDay,
  cloneWeek,
  dayHasRoom,
  defaultExerciseDraftFromCatalog,
  findSession,
  findSessionPlace,
  findSlot,
  mapSession,
  mapSessionExercises,
  moveSessionToDay,
  normalizeDraft,
  progressWeek,
  removeSessionExercise,
  removeSessionFromDay,
  reorderSessionInDay,
  straightSetsGroup,
  weekSessions,
} from "./program-builder-model";
import { MAX_SESSIONS_PER_DAY } from "@/lib/training-constants";
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
import { COLUMN_PRESET_FIELDS } from "@/utils/column-presets";

const exercise = (uid: string, overrides: Partial<ExerciseDraft> = {}): ExerciseDraft => ({
  ...defaultExerciseDraftFromCatalog({ name: uid, exerciseId: uid, exerciseType: "strength" }),
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

const session = (groups: ExerciseGroupDraft[], uid = "sess-1"): SessionDraft => ({
  uid,
  name: "Hybrid",
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups,
});

const order = (s: SessionDraft) => sessionExercises(s).map((e) => e.uid);

// A week whose first day holds `sessions`, in order; the other six are rest.
// The day at position d is `slot-<d>`.
function weekOf(...sessions: SessionDraft[]): WeekDraft {
  return {
    uid: "wk-1",
    weekIndex: 0,
    days: [
      { uid: "slot-0", orderIndex: 0, isRest: false, sessions },
      ...Array.from({ length: 6 }, (_, i) => ({ ...makeRestSlot(i + 1), uid: `slot-${i + 1}` })),
    ],
  };
}

function draftOf(...weeks: WeekDraft[]): ProgramDraft {
  return {
    id: "p",
    name: "P",
    description: null,
    status: "draft",
    splitType: null,
    programDurationWeeks: 1,
    defaultSurplusPercentage: null,
    weeks,
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
    const normalized = normalizeDraft(draft).weeks[0].days[0].sessions[0];
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
    expect(normalizeDraft(draft).weeks[0].days[0].sessions[0].groups).toEqual([
      { uid: "grp-c", ...STRAIGHT_SETS, exercises: [exercise("a")] },
    ]);
  });
});

describe("cloneWeek", () => {
  it("gives every group and exercise a fresh uid and keeps every setting and order", () => {
    const source = weekOf(session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("c")]));
    const copy = cloneWeek(source).days[0].sessions[0];
    const original = source.days[0].sessions[0];
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
    const s = next.days[0].sessions[0];
    expect([...changedExerciseUids].sort()).toEqual(["a", "b"]);
    expect(s.groups[0]).toMatchObject({ uid: "grp-c", format: "circuit", rounds: 4, restBetweenRoundsSeconds: 90 });
    expect(s.groups[0].exercises.map(setSpecCount)).toEqual([4, 4]);
    // The group nothing changed in keeps its reference.
    expect(s.groups[1]).toBe(week.days[0].sessions[0].groups[1]);
  });

  it("leaves a superset or circuit none of whose exercises is in scope", () => {
    const week = weekOf(session([circuit("grp-c", [exercise("a"), exercise("b")]), lone("c")]));
    const { week: next, changedExerciseUids } = progressWeek(
      week,
      { kind: "sets", amount: 1 },
      (e) => e.uid === "c",
    );
    expect([...changedExerciseUids]).toEqual(["c"]);
    expect(next.days[0].sessions[0].groups[0]).toBe(week.days[0].sessions[0].groups[0]);
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
    const [a, b] = next.days[0].sessions[0].groups[0].exercises;
    expect([...changedExerciseUids]).toEqual(["a"]);
    expect(a.repsMin).toBe(9);
    expect(setSpecCount(a)).toBe(3);
    expect(b).toBe(week.days[0].sessions[0].groups[0].exercises[1]);
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

// =============================================================================
// A day holds its sessions in order
// =============================================================================

describe("normalizeDraft over a day's sessions", () => {
  it("mirrors isRest from the day's session count and normalizes every session on it", () => {
    const week = weekOf(
      session([{ ...lone("gone"), exercises: [] }, lone("a")], "sess-am"),
      session([circuit("grp-c", [exercise("b")])], "sess-pm"),
    );
    // Stale mirrors both ways.
    week.days[0] = { ...week.days[0], isRest: true };
    week.days[1] = { ...week.days[1], isRest: false };
    const [first, second] = normalizeDraft(draftOf(week)).weeks[0].days;
    expect(first.isRest).toBe(false);
    expect(first.sessions.map((s) => s.uid)).toEqual(["sess-am", "sess-pm"]);
    expect(first.sessions[0].groups.map((g) => g.uid)).toEqual(["grp-a"]);
    expect(first.sessions[1].groups).toEqual([{ uid: "grp-c", ...STRAIGHT_SETS, exercises: [exercise("b")] }]);
    expect(second.isRest).toBe(true);
  });
});

describe("cloneWeek and progressWeek over a day holding two sessions", () => {
  it("cloneWeek copies every session of the day, in order, each a new session with new uids", () => {
    const source = weekOf(session([lone("a")], "sess-am"), session([lone("b")], "sess-pm"));
    const copy = cloneWeek(source).days[0];
    expect(copy.sessions).toHaveLength(2);
    expect(copy.sessions.map((s) => s.uid)).not.toContain("sess-am");
    expect(copy.sessions.map((s) => s.uid)).not.toContain("sess-pm");
    expect(new Set(copy.sessions.map((s) => s.uid)).size).toBe(2);
    expect(copy.sessions.map((s) => sessionExercises(s).map((e) => e.name))).toEqual([["a"], ["b"]]);
    expect(copy.sessions.flatMap((s) => sessionExercises(s).map((e) => e.uid))).not.toContain("a");
  });

  it("progressWeek progresses every session on the day; a session the rule leaves keeps its reference", () => {
    const week = weekOf(
      session([lone("a")], "sess-am"),
      session([lone("b")], "sess-pm"),
      session([lone("c")], "sess-late"),
    );
    const { week: next, changedExerciseUids } = progressWeek(
      week,
      { kind: "reps", amount: 1 },
      (e) => e.uid !== "b",
    );
    expect([...changedExerciseUids].sort()).toEqual(["a", "c"]);
    const [am, pm, late] = next.days[0].sessions;
    expect(sessionExercises(am)[0].repsMin).toBe(9);
    expect(pm).toBe(week.days[0].sessions[1]);
    expect(sessionExercises(late)[0].repsMin).toBe(9);
  });
});

describe("finding sessions on their days", () => {
  const draft = draftOf(weekOf(session([lone("a")], "sess-am"), session([lone("b")], "sess-pm")));

  it("findSessionPlace names the day and the place in it; findSession and findSlot resolve through the lists", () => {
    const place = findSessionPlace(draft, "sess-pm");
    expect(place?.slot.uid).toBe("slot-0");
    expect(place?.index).toBe(1);
    expect(findSession(draft, "sess-pm")?.uid).toBe("sess-pm");
    expect(findSlot(draft, "slot-3")?.orderIndex).toBe(3);
    expect(findSessionPlace(draft, "sess-gone")).toBeNull();
    expect(findSession(draft, null)).toBeNull();
    expect(findSlot(draft, "slot-gone")).toBeNull();
  });

  it("mapSession changes only the session it names; weekSessions lists a week's sessions day by day", () => {
    const next = mapSession(draft, "sess-pm", (s) => ({ ...s, name: "Evening" }));
    expect(next.weeks[0].days[0].sessions.map((s) => s.name)).toEqual(["Hybrid", "Evening"]);
    expect(next.weeks[0].days[0].sessions[0]).toBe(draft.weeks[0].days[0].sessions[0]);
    expect(weekSessions(draft.weeks[0]).map((s) => s.uid)).toEqual(["sess-am", "sess-pm"]);
  });
});

describe("removeSessionFromDay", () => {
  // Day 1 holds a morning and an evening session; day 4 holds one.
  function twoADay(): ProgramDraft {
    const week = weekOf(session([lone("a")], "sess-am"), session([lone("b")], "sess-pm"));
    week.days[3] = { ...week.days[3], isRest: false, sessions: [session([lone("c")], "sess-solo")] };
    return draftOf(week);
  }

  it("removes one of two sessions; the day keeps the other", () => {
    const next = normalizeDraft(removeSessionFromDay(twoADay(), "sess-am"));
    expect(next.weeks[0].days[0]).toMatchObject({ isRest: false });
    expect(next.weeks[0].days[0].sessions.map((s) => s.uid)).toEqual(["sess-pm"]);
  });

  it("removes a day's last session and the day is rest; a session no day holds changes nothing", () => {
    const draft = twoADay();
    const next = normalizeDraft(removeSessionFromDay(draft, "sess-solo"));
    expect(next.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });
    expect(removeSessionFromDay(draft, "sess-gone")).toBe(draft);
  });
});

describe("moveSessionToDay", () => {
  // Day 1 holds a morning and an evening session, days 4 and 5 one each, day 6 is rest.
  function fixture(): ProgramDraft {
    const week = weekOf(session([lone("a")], "sess-am"), session([lone("b")], "sess-pm"));
    week.days[3] = { ...week.days[3], isRest: false, sessions: [session([lone("c")], "sess-four")] };
    week.days[4] = { ...week.days[4], isRest: false, sessions: [session([lone("d")], "sess-five")] };
    return draftOf(week);
  }
  const uidsOn = (draft: ProgramDraft, d: number) => draft.weeks[0].days[d].sessions.map((s) => s.uid);
  const moved = (result: ReturnType<typeof moveSessionToDay>) => {
    if (!result.ok) throw new Error(result.reason);
    return normalizeDraft(result.draft);
  };

  it("onto a rest day it moves, and a day holding two keeps its other session", () => {
    const next = moved(moveSessionToDay(fixture(), "sess-pm", "slot-6"));
    expect(uidsOn(next, 6)).toEqual(["sess-pm"]);
    expect(uidsOn(next, 0)).toEqual(["sess-am"]);
    expect(next.weeks[0].days[0].isRest).toBe(false);
  });

  it("onto a rest day from a day it held alone, that day is rest", () => {
    const next = moved(moveSessionToDay(fixture(), "sess-four", "slot-6"));
    expect(uidsOn(next, 6)).toEqual(["sess-four"]);
    expect(next.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });
  });

  it("onto a day holding one it joins that day, LAST — no swap", () => {
    const next = moved(moveSessionToDay(fixture(), "sess-four", "slot-4"));
    expect(uidsOn(next, 4)).toEqual(["sess-five", "sess-four"]);
    expect(next.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });
  });

  it("onto a day holding two it joins after both; a session that shared its day leaves its partner", () => {
    const next = moved(moveSessionToDay(fixture(), "sess-five", "slot-0"));
    expect(uidsOn(next, 0)).toEqual(["sess-am", "sess-pm", "sess-five"]);
    const back = moved(moveSessionToDay(fixture(), "sess-am", "slot-3"));
    expect(uidsOn(back, 3)).toEqual(["sess-four", "sess-am"]);
    expect(uidsOn(back, 0)).toEqual(["sess-pm"]);
  });

  it("refuses a full day, and nothing moves", () => {
    const draft = fixture();
    const crowded: ProgramDraft = {
      ...draft,
      weeks: draft.weeks.map((w) => ({
        ...w,
        days: w.days.map((slot) =>
          slot.uid === "slot-6"
            ? {
                ...slot,
                isRest: false,
                sessions: Array.from({ length: MAX_SESSIONS_PER_DAY }, (_, i) =>
                  session([lone(`full-${i}`)], `sess-full-${i}`),
                ),
              }
            : slot,
        ),
      })),
    };
    expect(moveSessionToDay(crowded, "sess-four", "slot-6")).toEqual({ ok: false, reason: DAY_IS_FULL });
    expect(DAY_IS_FULL).toBe(`A day holds at most ${MAX_SESSIONS_PER_DAY} sessions`);
  });

  it("onto its own day changes nothing; a vanished session or day is a reason", () => {
    const draft = fixture();
    expect(moveSessionToDay(draft, "sess-pm", "slot-0")).toEqual({ ok: true, draft });
    expect(moveSessionToDay(draft, "sess-five", "slot-4")).toEqual({ ok: true, draft });
    expect(moveSessionToDay(draft, "sess-gone", "slot-6")).toEqual({
      ok: false,
      reason: "That session no longer exists",
    });
    expect(moveSessionToDay(draft, "sess-am", "slot-gone")).toEqual({
      ok: false,
      reason: "The target day no longer exists",
    });
  });
});

describe("addSessionToDay", () => {
  const uidsOn = (draft: ProgramDraft, d: number) => draft.weeks[0].days[d].sessions.map((s) => s.uid);

  it("on a rest day the session is the day's; on a day holding sessions it joins LAST", () => {
    const draft = draftOf(weekOf(session([lone("a")], "sess-am")));
    const onRest = addSessionToDay(draft, "slot-2", session([], "sess-new"));
    if (!onRest.ok) throw new Error(onRest.reason);
    expect(uidsOn(normalizeDraft(onRest.draft), 2)).toEqual(["sess-new"]);
    expect(normalizeDraft(onRest.draft).weeks[0].days[2].isRest).toBe(false);

    const second = addSessionToDay(draft, "slot-0", session([], "sess-pm"));
    if (!second.ok) throw new Error(second.reason);
    expect(uidsOn(second.draft, 0)).toEqual(["sess-am", "sess-pm"]);
  });

  it("refuses a full day and a vanished day; dayHasRoom says which days take one", () => {
    const sessions = Array.from({ length: MAX_SESSIONS_PER_DAY }, (_, i) => session([], `sess-${i}`));
    const draft = draftOf(weekOf(...sessions));
    expect(dayHasRoom(draft.weeks[0].days[0])).toBe(false);
    expect(dayHasRoom(draft.weeks[0].days[1])).toBe(true);
    expect(addSessionToDay(draft, "slot-0", session([], "sess-extra"))).toEqual({
      ok: false,
      reason: DAY_IS_FULL,
    });
    expect(addSessionToDay(draft, "slot-gone", session([], "sess-extra"))).toEqual({
      ok: false,
      reason: "That day no longer exists",
    });
    // One short of full still takes one.
    const nearlyFull = draftOf(weekOf(...sessions.slice(1)));
    expect(addSessionToDay(nearlyFull, "slot-0", session([], "sess-extra")).ok).toBe(true);
  });
});

describe("reorderSessionInDay", () => {
  const three = () =>
    draftOf(
      weekOf(session([lone("a")], "sess-a"), session([lone("b")], "sess-b"), session([lone("c")], "sess-c")),
    );
  const uids = (draft: ProgramDraft) => draft.weeks[0].days[0].sessions.map((s) => s.uid);

  it("puts the session at the place, the others keeping their order around it", () => {
    expect(uids(reorderSessionInDay(three(), "sess-c", 0))).toEqual(["sess-c", "sess-a", "sess-b"]);
    expect(uids(reorderSessionInDay(three(), "sess-a", 2))).toEqual(["sess-b", "sess-c", "sess-a"]);
    expect(uids(reorderSessionInDay(three(), "sess-a", 1))).toEqual(["sess-b", "sess-a", "sess-c"]);
  });

  it("clamps the place to the day, and changes nothing when the session is already there or gone", () => {
    expect(uids(reorderSessionInDay(three(), "sess-a", 99))).toEqual(["sess-b", "sess-c", "sess-a"]);
    expect(uids(reorderSessionInDay(three(), "sess-c", -3))).toEqual(["sess-c", "sess-a", "sess-b"]);
    const draft = three();
    expect(reorderSessionInDay(draft, "sess-b", 1)).toBe(draft);
    expect(reorderSessionInDay(draft, "sess-gone", 0)).toBe(draft);
    // A place past either end of the day, for the session already at that end.
    expect(reorderSessionInDay(draft, "sess-c", 99)).toBe(draft);
    expect(reorderSessionInDay(draft, "sess-a", -3)).toBe(draft);
  });

  it("touches only the session's day", () => {
    const draft = three();
    const next = reorderSessionInDay(draft, "sess-c", 0);
    expect(next.weeks[0].days[1]).toBe(draft.weeks[0].days[1]);
  });
});

// A catalog pick starts on its type's preset (commit 13); free text on
// Strength. The reps default follows the columns: 3 × 8–12 where they ask
// for reps, no rep range where they don't.
describe("defaultExerciseDraftFromCatalog", () => {
  it("starts a catalog pick on its type's preset", () => {
    const row = defaultExerciseDraftFromCatalog({ name: "Rowing Machine", exerciseId: "e-row", exerciseType: "erg" });
    expect(row.prescribedFields).toEqual([...COLUMN_PRESET_FIELDS.erg]);
    expect(row.exerciseId).toBe("e-row");
  });

  it("gives 3 sets of 8–12 where the columns ask for reps, and 3 sets with no rep range where they don't", () => {
    const bench = defaultExerciseDraftFromCatalog({ name: "Bench", exerciseId: "e1", exerciseType: "strength" });
    expect([bench.sets, bench.repsMin, bench.repsMax]).toEqual([3, 8, 12]);
    const jump = defaultExerciseDraftFromCatalog({ name: "Box Jump", exerciseId: "e2", exerciseType: "bodyweight" });
    expect([jump.sets, jump.repsMin, jump.repsMax]).toEqual([3, 8, 12]);

    for (const exerciseType of ["endurance", "erg", "carry_sled", "holds"] as const) {
      const draft = defaultExerciseDraftFromCatalog({ name: exerciseType, exerciseId: "e3", exerciseType });
      expect(draft.prescribedFields).not.toContain("reps");
      expect([draft.sets, draft.repsMin, draft.repsMax]).toEqual([3, null, null]);
      expect(draft.setSpecs).toBeNull();
    }
  });

  it("hands back a fresh column list each time", () => {
    const a = defaultExerciseDraftFromCatalog({ name: "Run", exerciseId: "e4", exerciseType: "endurance" });
    a.prescribedFields.push("reps");
    const b = defaultExerciseDraftFromCatalog({ name: "Run", exerciseId: "e4", exerciseType: "endurance" });
    expect(b.prescribedFields).toEqual([...COLUMN_PRESET_FIELDS.endurance]);
  });
});
