import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrescribedField } from "@/utils/prescribed-fields";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { STRAIGHT_SETS, sessionExercises, type GroupSettings } from "@/utils/exercise-groups";
import { setSpecCount } from "@/utils/exercise-set-specs";
import { useProgramBuilderState, findSession } from "./use-program-builder-state";
import { MAX_SESSIONS_PER_DAY } from "@/lib/training-constants";
import {
  DAYS_PER_WEEK,
  MAX_WEEKS,
  makeRestWeek,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type ProgramDraft,
  type SessionDraft,
} from "./program-builder-types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function makeDraft(weekCount = 1): ProgramDraft {
  return {
    id: "plan-1",
    name: "P",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: Array.from({ length: weekCount }, (_, i) => makeRestWeek(i)),
  };
}

function setup(weekCount = 1) {
  const hook = renderHook(() => useProgramBuilderState());
  act(() => hook.result.current.seed(makeDraft(weekCount)));
  return hook;
}

// A day's first session (these days hold one unless a test says otherwise).
const sessionAt = (draft: ProgramDraft, w: number, d: number): SessionDraft | null =>
  draft.weeks[w].days[d].sessions[0] ?? null;

describe("useProgramBuilderState — weeks", () => {
  it("seed is clean; addWeek appends 7 rest slots, renumbers, and dirties", () => {
    const { result } = setup(1);
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.addWeek());
    const draft = result.current.draft!;
    expect(result.current.isDirty).toBe(true);
    expect(draft.weeks).toHaveLength(2);
    expect(draft.weeks[1].days).toHaveLength(DAYS_PER_WEEK);
    expect(draft.weeks[1].days.every((s) => s.isRest && s.sessions.length === 0)).toBe(true);
    expect(draft.weeks.map((w) => w.weekIndex)).toEqual([0, 1]);
  });

  it("caps at MAX_WEEKS (52 — zod's inclusive 52 would allow a 53rd)", () => {
    const { result } = renderHook(() => useProgramBuilderState());
    act(() => result.current.seed(makeDraft(MAX_WEEKS)));
    act(() => result.current.addWeek());
    expect(result.current.draft!.weeks).toHaveLength(MAX_WEEKS);
    act(() => result.current.duplicateWeek(result.current.draft!.weeks[0].uid));
    expect(result.current.draft!.weeks).toHaveLength(MAX_WEEKS);
  });

  it("duplicateWeek deep-clones with fresh uids and inserts after the source", () => {
    const { result } = setup(2);
    const first = result.current.draft!.weeks[0];
    act(() => {
      result.current.addSessionToSlot(first.days[0].uid);
    });
    const source = result.current.draft!.weeks[0];

    act(() => result.current.duplicateWeek(source.uid));
    const draft = result.current.draft!;
    expect(draft.weeks).toHaveLength(3);
    const clone = draft.weeks[1];
    expect(clone.uid).not.toBe(source.uid);
    expect(clone.days[0].uid).not.toBe(source.days[0].uid);
    expect(sessionAt(draft, 1, 0)!.uid).not.toBe(sessionAt(draft, 0, 0)!.uid);
    expect(sessionAt(draft, 1, 0)!.name).toBe(sessionAt(draft, 0, 0)!.name);
    expect(draft.weeks.map((w) => w.weekIndex)).toEqual([0, 1, 2]);

    // Mutating the clone leaves the source untouched.
    act(() =>
      result.current.updateSession(clone.days[0].sessions[0].uid, { name: "Changed" }),
    );
    expect(sessionAt(result.current.draft!, 0, 0)!.name).not.toBe("Changed");
    expect(sessionAt(result.current.draft!, 1, 0)!.name).toBe("Changed");
  });

  it("deleteWeek is a no-op at one week (min-1 invariant)", () => {
    const { result } = setup(1);
    act(() => result.current.deleteWeek(result.current.draft!.weeks[0].uid));
    expect(result.current.draft!.weeks).toHaveLength(1);
  });

  it("deleteWeek and reorderWeek renumber weekIndex", () => {
    const { result } = setup(3);
    const [w0, w1, w2] = result.current.draft!.weeks;
    act(() => {
      result.current.addSessionToSlot(w2.days[0].uid);
    });

    act(() => result.current.reorderWeek(w2.uid, w0.uid));
    let draft = result.current.draft!;
    expect(draft.weeks.map((w) => w.uid)).toEqual([w2.uid, w0.uid, w1.uid]);
    expect(draft.weeks.map((w) => w.weekIndex)).toEqual([0, 1, 2]);
    expect(sessionAt(draft, 0, 0)).not.toBeNull();

    act(() => result.current.deleteWeek(w0.uid));
    draft = result.current.draft!;
    expect(draft.weeks.map((w) => w.uid)).toEqual([w2.uid, w1.uid]);
    expect(draft.weeks.map((w) => w.weekIndex)).toEqual([0, 1]);
  });
});

describe("useProgramBuilderState — day slots", () => {
  it("addSessionToSlot fills a rest slot, then adds a second session last; clearSlot reverts it to rest", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[2];

    let firstUid: string | null = null;
    act(() => {
      firstUid = result.current.addSessionToSlot(slot.uid);
    });
    let updated = result.current.draft!.weeks[0].days[2];
    expect(updated.isRest).toBe(false);
    expect(updated.sessions.map((s) => s.name)).toEqual(["Day 3"]);
    // It hands back the uid of the session it added.
    expect(updated.sessions[0].uid).toBe(firstUid);

    // Adding onto a day holding a session adds another, after it.
    let secondUid: string | null = null;
    act(() => {
      secondUid = result.current.addSessionToSlot(slot.uid, "PM lift");
    });
    expect(result.current.draft!.weeks[0].days[2].sessions.map((s) => [s.uid, s.name])).toEqual([
      [firstUid, "Day 3"],
      [secondUid, "PM lift"],
    ]);

    act(() => result.current.clearSlot(slot.uid));
    updated = result.current.draft!.weeks[0].days[2];
    expect(updated.isRest).toBe(true);
    expect(updated.sessions).toEqual([]);
  });

  it("moveSession to a rest slot moves (source becomes rest)", () => {
    const { result } = setup(2);
    const source = result.current.draft!.weeks[0].days[0];
    act(() => {
      result.current.addSessionToSlot(source.uid);
    });
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;
    const target = result.current.draft!.weeks[1].days[6];

    act(() => result.current.moveSession(sessionUid, target.uid));
    const draft = result.current.draft!;
    expect(sessionAt(draft, 0, 0)).toBeNull();
    expect(draft.weeks[0].days[0].isRest).toBe(true);
    expect(sessionAt(draft, 1, 6)!.uid).toBe(sessionUid);
    expect(draft.weeks[1].days[6].isRest).toBe(false);
  });

  it("moveSession onto an occupied slot joins it, last — no swap", () => {
    const { result } = setup(1);
    const [a, b] = [
      result.current.draft!.weeks[0].days[0],
      result.current.draft!.weeks[0].days[3],
    ];
    act(() => {
      result.current.addSessionToSlot(a.uid);
    });
    act(() => {
      result.current.addSessionToSlot(b.uid);
    });
    const uidA = sessionAt(result.current.draft!, 0, 0)!.uid;
    const uidB = sessionAt(result.current.draft!, 0, 3)!.uid;

    act(() => result.current.moveSession(uidA, b.uid));
    const draft = result.current.draft!;
    expect(draft.weeks[0].days[3].sessions.map((s) => s.uid)).toEqual([uidB, uidA]);
    // Slots stayed put; orderIndex/isRest still consistent — day 1 is rest now.
    expect(draft.weeks[0].days.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(draft.weeks[0].days.map((s) => s.isRest)).toEqual([
      true, true, true, false, true, true, true,
    ]);
  });
});

describe("useProgramBuilderState — a day holding several sessions", () => {
  const blank = (uid: string, name: string): SessionDraft => ({
    uid,
    name,
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [],
  });

  // Day 1 holds a morning run then an evening lift, day 4 holds Upper, and
  // every other day is rest.
  function seedTwoADay() {
    const draft = makeDraft(1);
    const days = draft.weeks[0].days;
    days[0] = {
      ...days[0],
      isRest: false,
      sessions: [blank("sess-run", "AM run"), blank("sess-lift", "PM lift")],
    };
    days[3] = { ...days[3], isRest: false, sessions: [blank("sess-upper", "Upper")] };
    const hook = renderHook(() => useProgramBuilderState());
    act(() => hook.result.current.seed(draft));
    return hook;
  }

  const namesOn = (draft: ProgramDraft, d: number) =>
    draft.weeks[0].days[d].sessions.map((s) => s.name);

  it("removeSession takes one of two sessions off its day, and the day keeps the other", () => {
    const { result } = seedTwoADay();
    act(() => result.current.removeSession("sess-run"));
    const draft = result.current.draft!;
    expect(namesOn(draft, 0)).toEqual(["PM lift"]);
    expect(draft.weeks[0].days[0].isRest).toBe(false);
    expect(namesOn(draft, 3)).toEqual(["Upper"]);
    expect(result.current.isDirty).toBe(true);
  });

  it("removeSession of a day's last session makes it a rest day; a vanished session is a clean no-op", () => {
    const { result } = seedTwoADay();
    act(() => result.current.removeSession("sess-upper"));
    expect(result.current.draft!.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });
    expect(namesOn(result.current.draft!, 0)).toEqual(["AM run", "PM lift"]);

    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    act(() => result.current.removeSession("sess-upper"));
    expect(result.current.isDirty).toBe(false);
  });

  it("clearSlot empties the whole day, every session on it", () => {
    const { result } = seedTwoADay();
    act(() => result.current.clearSlot(result.current.draft!.weeks[0].days[0].uid));
    expect(result.current.draft!.weeks[0].days[0]).toMatchObject({ isRest: true, sessions: [] });
    expect(namesOn(result.current.draft!, 3)).toEqual(["Upper"]);
  });

  it("moveSession takes one session of a day holding two onto a rest day; the day it left keeps the other", () => {
    const { result } = seedTwoADay();
    act(() => result.current.moveSession("sess-lift", result.current.draft!.weeks[0].days[5].uid));
    const draft = result.current.draft!;
    expect(namesOn(draft, 5)).toEqual(["PM lift"]);
    expect(draft.weeks[0].days[5].isRest).toBe(false);
    expect(namesOn(draft, 0)).toEqual(["AM run"]);
    expect(draft.weeks[0].days[0].isRest).toBe(false);
  });

  it("moveSession joins a day holding two, last, and a session that shares its day joins a day holding one", () => {
    const { result } = seedTwoADay();
    const [dayOne, , , dayFour] = result.current.draft!.weeks[0].days;

    act(() => result.current.moveSession("sess-upper", dayOne.uid));
    expect(namesOn(result.current.draft!, 0)).toEqual(["AM run", "PM lift", "Upper"]);
    expect(result.current.draft!.weeks[0].days[3]).toMatchObject({ isRest: true, sessions: [] });

    act(() => result.current.moveSession("sess-run", dayFour.uid));
    expect(namesOn(result.current.draft!, 3)).toEqual(["AM run"]);
    expect(namesOn(result.current.draft!, 0)).toEqual(["PM lift", "Upper"]);
    expect(result.current.isDirty).toBe(true);
  });

  it("moveSession onto its own day, and onto a full day, changes nothing and doesn't dirty", () => {
    const { result } = seedTwoADay();
    const before = result.current.draft;
    const [dayOne, , , , , , daySeven] = before!.weeks[0].days;
    act(() => result.current.moveSession("sess-lift", dayOne.uid));
    expect(result.current.draft).toBe(before);
    expect(result.current.isDirty).toBe(false);

    for (let i = 0; i < MAX_SESSIONS_PER_DAY; i++) {
      act(() => result.current.placeSession(daySeven.uid, blank(`sess-full-${i}`, `Full ${i}`)));
    }
    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    const full = result.current.draft;
    act(() => result.current.moveSession("sess-upper", daySeven.uid));
    // One more by any way in is refused the same way.
    act(() => result.current.placeSession(daySeven.uid, blank("sess-extra", "Extra")));
    let added: string | null = "unset";
    act(() => {
      added = result.current.addSessionToSlot(daySeven.uid);
    });
    expect(added).toBeNull();
    expect(result.current.draft).toBe(full);
    expect(result.current.isDirty).toBe(false);
  });

  it("reorderSession changes a session's place in its day; already there is a clean no-op", () => {
    const { result } = seedTwoADay();
    act(() => result.current.reorderSession("sess-lift", 0));
    expect(namesOn(result.current.draft!, 0)).toEqual(["PM lift", "AM run"]);
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    const before = result.current.draft;
    act(() => result.current.reorderSession("sess-lift", 0));
    act(() => result.current.reorderSession("sess-gone", 1));
    expect(result.current.draft).toBe(before);
    expect(result.current.isDirty).toBe(false);
  });
});

describe("useProgramBuilderState — placeSession (library insert)", () => {
  const makeLibraryClone = (): SessionDraft => ({
    uid: "sess-lib",
    name: "Push Day A",
    focus: "push",
    estimatedDurationMinutes: 45,
    calorieSurplusPercentage: 10,
    notes: null,
    sessionType: "training",
    groups: [],
  });

  it("inserts a pre-built SessionDraft into an empty slot and dirties", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[2];
    act(() => result.current.placeSession(slot.uid, makeLibraryClone()));

    const placed = sessionAt(result.current.draft!, 0, 2);
    expect(placed?.name).toBe("Push Day A");
    expect(placed?.calorieSurplusPercentage).toBe(10);
    expect(result.current.draft!.weeks[0].days[2].isRest).toBe(false);
    expect(result.current.isDirty).toBe(true);
  });

  it("on a day holding a session, the clone joins it, after the session already there", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[0];
    act(() => {
      result.current.addSessionToSlot(slot.uid);
    });
    const original = sessionAt(result.current.draft!, 0, 0);

    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    act(() => result.current.placeSession(slot.uid, makeLibraryClone()));

    const day = result.current.draft!.weeks[0].days[0];
    expect(day.sessions.map((s) => s.name)).toEqual(["Day 1", "Push Day A"]);
    expect(day.sessions[0]).toEqual(original);
    expect(result.current.isDirty).toBe(true);
  });

  it("addSessionToSlot accepts a custom name (create-blank flow)", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[4];
    act(() => {
      result.current.addSessionToSlot(slot.uid, "Untitled session");
    });
    expect(sessionAt(result.current.draft!, 0, 4)?.name).toBe("Untitled session");
  });
});

describe("useProgramBuilderState — exercises + normalize", () => {
  const baseExercise = {
    exerciseId: null,
    name: "Bench",
    setSpecs: null,
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: ["set_type", "reps", "load", "rpe", "rest"] as PrescribedField[],
  };

  it("add/update/remove exercise via session uid", () => {
    const { result } = setup(1);
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid);
    });
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;

    act(() => result.current.addExercise(sessionUid, baseExercise));
    let session = findSession(result.current.draft, sessionUid)!;
    expect(sessionExercises(session)).toHaveLength(1);
    const exUid = sessionExercises(session)[0].uid;

    act(() => result.current.updateExercise(sessionUid, exUid, { name: "Incline Bench" }));
    session = findSession(result.current.draft, sessionUid)!;
    expect(sessionExercises(session)[0].name).toBe("Incline Bench");

    act(() => result.current.removeExercise(sessionUid, exUid));
    expect(sessionExercises(findSession(result.current.draft, sessionUid)!)).toHaveLength(0);
  });

  it("normalize reverts an empty setSpecs array to null (never serialize [])", () => {
    const { result } = setup(1);
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid);
    });
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;
    act(() => result.current.addExercise(sessionUid, baseExercise));
    const exUid = sessionExercises(findSession(result.current.draft, sessionUid)!)[0].uid;

    act(() => result.current.updateExercise(sessionUid, exUid, { setSpecs: [] }));
    expect(sessionExercises(findSession(result.current.draft, sessionUid)!)[0].setSpecs).toBeNull();
  });

  it("normalize renumbers set_number after spec updates", () => {
    const { result } = setup(1);
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid);
    });
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;
    act(() => result.current.addExercise(sessionUid, baseExercise));
    const exUid = sessionExercises(findSession(result.current.draft, sessionUid)!)[0].uid;

    act(() =>
      result.current.updateExercise(sessionUid, exUid, {
        setSpecs: [
          { set_number: 9, set_type: "warmup" },
          { set_number: 9, set_type: "working" },
        ],
      }),
    );
    const specs = sessionExercises(findSession(result.current.draft, sessionUid)!)[0].setSpecs!;
    expect(specs.map((s) => s.set_number)).toEqual([1, 2]);
  });
});

describe("useProgramBuilderState — exercises sit in groups", () => {
  const SESSION_UID = "sess-groups";

  // What a catalog pick hands addExercise.
  const PICKED: Omit<ExerciseDraft, "uid"> = {
    exerciseId: null,
    name: "Row",
    setSpecs: null,
    sets: 4,
    repsMin: 6,
    repsMax: 10,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
  };

  const exercise = (uid: string, name: string): ExerciseDraft => ({ ...PICKED, uid, name });
  const A = exercise("ex-a", "Bench");
  const B = exercise("ex-b", "Pull-up");
  const C = exercise("ex-c", "Dip");
  const D = exercise("ex-d", "Curl");

  // A lone exercise: a straight-sets group of one.
  const lone = (ex: ExerciseDraft): ExerciseGroupDraft => ({
    uid: `grp-${ex.uid}`,
    ...STRAIGHT_SETS,
    exercises: [ex],
  });

  // Settings a lone exercise never carries.
  const CIRCUIT: GroupSettings = {
    format: "circuit",
    rounds: 4,
    timeCapSeconds: null,
    intervalSeconds: null,
    restBetweenExercisesSeconds: 15,
    restBetweenRoundsSeconds: 90,
    notes: "Pull-up and dip back to back",
  };

  // Bench alone, Pull-up + Dip as one two-exercise circuit, Curl alone.
  const grouped = (): ExerciseGroupDraft[] => [
    lone(A),
    { uid: "grp-bc", ...CIRCUIT, exercises: [B, C] },
    lone(D),
  ];

  function seedSession(groups: ExerciseGroupDraft[]) {
    const draft = makeDraft(1);
    draft.weeks[0].days[0] = {
      ...draft.weeks[0].days[0],
      isRest: false,
      sessions: [
        {
          uid: SESSION_UID,
          name: "Upper",
          focus: null,
          estimatedDurationMinutes: null,
          calorieSurplusPercentage: null,
          notes: null,
          sessionType: "training",
          groups,
        },
      ],
    };
    const hook = renderHook(() => useProgramBuilderState());
    act(() => hook.result.current.seed(draft));
    return hook;
  }

  const sessionOf = (hook: ReturnType<typeof seedSession>) =>
    findSession(hook.result.current.draft, SESSION_UID)!;

  it("addExercise appends a straight-sets group of one holding the new exercise", () => {
    const hook = seedSession([lone(A)]);

    act(() => hook.result.current.addExercise(SESSION_UID, PICKED));
    const groups = sessionOf(hook).groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(lone(A));
    expect(groups[1]).toEqual({
      uid: expect.stringMatching(/^grp-/),
      format: "straight_sets",
      rounds: null,
      timeCapSeconds: null,
      intervalSeconds: null,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
      notes: null,
      exercises: [{ ...PICKED, uid: expect.stringMatching(/^ex-/) }],
    });
    expect(groups[1].uid).not.toBe(groups[0].uid);
    expect(hook.result.current.isDirty).toBe(true);

    // The next pick is a group of its own, never a second exercise of the last one.
    act(() => hook.result.current.addExercise(SESSION_UID, { ...PICKED, name: "Curl" }));
    const next = sessionOf(hook).groups;
    expect(next.map((g) => g.exercises.map((e) => e.name))).toEqual([["Bench"], ["Row"], ["Curl"]]);
    expect(next[2]).toMatchObject(STRAIGHT_SETS);
    expect(new Set(next.map((g) => g.uid)).size).toBe(3);
  });

  it("removeExercise drops the group its last exercise leaves, and makes a group left with one a plain exercise", () => {
    const hook = seedSession(grouped());

    // Bench was alone: its group goes with it.
    act(() => hook.result.current.removeExercise(SESSION_UID, "ex-a"));
    expect(sessionOf(hook).groups).toEqual([
      { uid: "grp-bc", ...CIRCUIT, exercises: [B, C] },
      lone(D),
    ]);

    // One of the circuit's two leaves: the other is a plain exercise, nothing set.
    act(() => hook.result.current.removeExercise(SESSION_UID, "ex-b"));
    expect(sessionOf(hook).groups).toEqual([
      { uid: "grp-bc", ...STRAIGHT_SETS, exercises: [C] },
      lone(D),
    ]);

    // Its last one leaves: now the circuit goes too.
    act(() => hook.result.current.removeExercise(SESSION_UID, "ex-c"));
    expect(sessionOf(hook).groups).toEqual([lone(D)]);
  });

  it("updateExercise inside a two-exercise group changes only that exercise; the group keeps its uid and settings", () => {
    const hook = seedSession(grouped());

    act(() =>
      hook.result.current.updateExercise(SESSION_UID, "ex-c", { name: "Ring dip", repsMin: 5 }),
    );
    expect(sessionOf(hook).groups).toEqual([
      lone(A),
      { uid: "grp-bc", ...CIRCUIT, exercises: [B, { ...C, name: "Ring dip", repsMin: 5 }] },
      lone(D),
    ]);
    expect(hook.result.current.isDirty).toBe(true);
  });

  beforeEach(() => vi.mocked(toast.error).mockClear());

  it("linkExercises makes a superset under a fresh group uid, where the first picked exercise was", () => {
    const hook = seedSession([lone(A), lone(B), lone(C), lone(D)]);

    act(() => hook.result.current.linkExercises(SESSION_UID, ["ex-d", "ex-b"]));
    const groups = sessionOf(hook).groups;
    expect(groups.map((g) => g.exercises.map((e) => e.uid))).toEqual([
      ["ex-a"],
      ["ex-b", "ex-d"],
      ["ex-c"],
    ]);
    expect(groups[1]).toMatchObject({ format: "circuit", rounds: 4 });
    expect(groups[1].uid).toMatch(/^grp-/);
    expect(hook.result.current.isDirty).toBe(true);
  });

  it("a refused group edit toasts its reason and leaves the draft clean", () => {
    const hook = seedSession([lone(A), lone(B)]);
    const before = hook.result.current.draft;

    act(() => hook.result.current.linkExercises(SESSION_UID, ["ex-a"]));
    expect(toast.error).toHaveBeenCalledWith("Pick at least two exercises to link");
    expect(hook.result.current.draft).toBe(before);
    expect(hook.result.current.isDirty).toBe(false);
  });

  it("unlinkGroup makes every exercise a plain exercise in place, each in a group of its own", () => {
    const hook = seedSession(grouped());

    act(() => hook.result.current.unlinkGroup(SESSION_UID, "grp-bc"));
    const groups = sessionOf(hook).groups;
    expect(groups.map((g) => g.exercises.map((e) => e.uid))).toEqual([
      ["ex-a"],
      ["ex-b"],
      ["ex-c"],
      ["ex-d"],
    ]);
    expect(groups[1]).toEqual({ uid: expect.stringMatching(/^grp-/), ...STRAIGHT_SETS, exercises: [B] });
    expect(new Set(groups.map((g) => g.uid)).size).toBe(4);
  });

  it("moveExercise joins a group and leaves one; a drop where it is doesn't dirty the draft", () => {
    const hook = seedSession(grouped());

    act(() => hook.result.current.moveExercise(SESSION_UID, "ex-a", { kind: "session", index: 1 }));
    expect(hook.result.current.isDirty).toBe(false);

    act(() =>
      hook.result.current.moveExercise(SESSION_UID, "ex-d", { kind: "group", groupUid: "grp-bc", index: 0 }),
    );
    expect(sessionOf(hook).groups.map((g) => g.exercises.map((e) => e.uid))).toEqual([
      ["ex-a"],
      ["ex-d", "ex-b", "ex-c"],
    ]);

    act(() => hook.result.current.moveExercise(SESSION_UID, "ex-c", { kind: "session", index: 0 }));
    const groups = sessionOf(hook).groups;
    expect(groups.map((g) => g.exercises.map((e) => e.uid))).toEqual([
      ["ex-c"],
      ["ex-a"],
      ["ex-d", "ex-b"],
    ]);
    expect(groups[0].uid).toMatch(/^grp-/);
    expect(hook.result.current.isDirty).toBe(true);
  });

  it("moveGroup moves a whole group, and updateGroup changes its settings and every exercise's rounds", () => {
    const hook = seedSession(grouped());

    act(() => hook.result.current.moveGroup(SESSION_UID, "grp-bc", 3));
    expect(sessionExercises(sessionOf(hook)).map((e) => e.uid)).toEqual(["ex-a", "ex-d", "ex-b", "ex-c"]);

    act(() =>
      hook.result.current.updateGroup(SESSION_UID, "grp-bc", {
        rounds: 2,
        restBetweenRoundsSeconds: 120,
      }),
    );
    const circuit = sessionOf(hook).groups[2];
    expect(circuit).toMatchObject({ uid: "grp-bc", rounds: 2, restBetweenRoundsSeconds: 120 });
    expect(circuit.exercises.map(setSpecCount)).toEqual([2, 2]);
  });
});

describe("useProgramBuilderState — no-op mutations + revision tracking", () => {
  it("no-op mutations never dirty the tree (leave guards stay disarmed)", () => {
    const { result } = setup(1);

    // deleteWeek at the min-1 floor is a no-op.
    act(() => result.current.deleteWeek(result.current.draft!.weeks[0].uid));
    expect(result.current.isDirty).toBe(false);

    // Real edit dirties; markSaved at the current revision cleans.
    const slot = result.current.draft!.weeks[0].days[0];
    act(() => {
      result.current.addSessionToSlot(slot.uid);
    });
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    expect(result.current.isDirty).toBe(false);

    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;
    // Self-drop (drag released over its own slot).
    act(() => result.current.moveSession(sessionUid, slot.uid));
    // Its own place in its own day.
    act(() => result.current.reorderSession(sessionUid, 0));
    // Blur-without-change commits.
    act(() => result.current.updateSession(sessionUid, { name: "Day 1" }));
    act(() => result.current.setName("P"));
    act(() => result.current.setDescription(null));
    act(() => result.current.setDefaultSurplus(null));
    expect(result.current.isDirty).toBe(false);
  });

  it("setDescription updates the description and dirties the tree", () => {
    const { result } = setup(1);
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setDescription("4-day upper/lower for hypertrophy"));
    expect(result.current.draft!.description).toBe(
      "4-day upper/lower for hypertrophy",
    );
    expect(result.current.isDirty).toBe(true);

    // Clearing back to null is a real change too.
    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setDescription(null));
    expect(result.current.draft!.description).toBeNull();
    expect(result.current.isDirty).toBe(true);
  });

  it("markSaved clears dirty only when nothing mutated since the snapshot", () => {
    const { result } = setup(1);
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid);
    });

    // Snapshot taken at save time; an edit lands while the save is in flight.
    const revision = result.current.getRevision();
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[1].uid);
    });

    let clean = true;
    act(() => {
      clean = result.current.markSaved(revision);
    });
    expect(clean).toBe(false);
    expect(result.current.isDirty).toBe(true); // the mid-save edit is NOT saved
    expect(result.current.draft!.status).toBe("saved");

    act(() => {
      clean = result.current.markSaved(result.current.getRevision());
    });
    expect(clean).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });
});

describe("useProgramBuilderState — assistant additions (builder S6a)", () => {
  const makeSessionOps = (sessionUid: string) => [
    {
      type: "update_session" as const,
      sessionUid,
      patch: { notes: "from the assistant" },
    },
    {
      type: "update_session" as const,
      sessionUid: "sess-vanished",
      patch: { notes: "never lands" },
    },
  ];

  it("applyAssistantOps applies a whole turn as ONE revision bump and surfaces skips", () => {
    const { result } = setup(1);
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid);
    });
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;

    const before = result.current.getRevision();
    let opsResult: ReturnType<typeof result.current.applyAssistantOps> = null;
    act(() => {
      opsResult = result.current.applyAssistantOps(makeSessionOps(sessionUid), {
        target: "library",
      });
    });
    expect(opsResult!.applied).toBe(1);
    expect(opsResult!.skipped).toHaveLength(1);
    expect(opsResult!.skipped[0].reason).toMatch(/no longer exists/);
    expect(sessionAt(result.current.draft!, 0, 0)!.notes).toBe("from the assistant");
    // One bump for the whole turn — markSaved semantics identical to a hand edit.
    expect(result.current.getRevision()).toBe(before + 1);
    expect(result.current.isDirty).toBe(true);
  });

  it("replaceDraft restores a snapshot THROUGH apply (revision moves — the markSaved race is closed)", () => {
    const { result } = setup(1);
    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid);
    });
    const snapshot = result.current.getDraft()!;
    const wasDirty = result.current.getDirty();

    act(() => {
      result.current.addSessionToSlot(result.current.draft!.weeks[0].days[1].uid);
    });
    const saveRevision = result.current.getRevision();

    // Undo lands while a save is in flight…
    act(() => {
      result.current.replaceDraft(snapshot);
      result.current.restoreDirty(wasDirty);
    });
    // …so markSaved MUST see a moved counter and refuse to mark clean.
    let clean = true;
    act(() => {
      clean = result.current.markSaved(saveRevision);
    });
    expect(clean).toBe(false);
    expect(result.current.draft!.weeks[0].days[1].sessions).toEqual([]); // restored tree
    expect(sessionAt(result.current.draft!, 0, 0)).not.toBeNull();
  });
});
