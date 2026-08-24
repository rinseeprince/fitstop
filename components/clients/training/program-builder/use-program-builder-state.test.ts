import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useProgramBuilderState, findSession } from "./use-program-builder-state";
import {
  DAYS_PER_WEEK,
  MAX_WEEKS,
  makeRestWeek,
  type ProgramDraft,
  type SessionDraft,
} from "./program-builder-types";

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

const sessionAt = (draft: ProgramDraft, w: number, d: number): SessionDraft | null =>
  draft.weeks[w].days[d].session;

describe("useProgramBuilderState — weeks", () => {
  it("seed is clean; addWeek appends 7 rest slots, renumbers, and dirties", () => {
    const { result } = setup(1);
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.addWeek());
    const draft = result.current.draft!;
    expect(result.current.isDirty).toBe(true);
    expect(draft.weeks).toHaveLength(2);
    expect(draft.weeks[1].days).toHaveLength(DAYS_PER_WEEK);
    expect(draft.weeks[1].days.every((s) => s.isRest && s.session === null)).toBe(true);
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
    act(() => result.current.addSessionToSlot(first.days[0].uid));
    const source = result.current.draft!.weeks[0];

    act(() => result.current.duplicateWeek(source.uid));
    const draft = result.current.draft!;
    expect(draft.weeks).toHaveLength(3);
    const clone = draft.weeks[1];
    expect(clone.uid).not.toBe(source.uid);
    expect(clone.days[0].uid).not.toBe(source.days[0].uid);
    expect(clone.days[0].session!.uid).not.toBe(draft.weeks[0].days[0].session!.uid);
    expect(clone.days[0].session!.name).toBe(draft.weeks[0].days[0].session!.name);
    expect(draft.weeks.map((w) => w.weekIndex)).toEqual([0, 1, 2]);

    // Mutating the clone leaves the source untouched.
    act(() =>
      result.current.updateSession(clone.days[0].session!.uid, { name: "Changed" }),
    );
    expect(sessionAt(result.current.draft!, 0, 0)!.name).not.toBe("Changed");
    expect(sessionAt(result.current.draft!, 1, 0)!.name).toBe("Changed");
  });

  it("insertWeekAfter inserts after the source, renumbers, and dirties", () => {
    const { result } = setup(2);
    const [w0] = result.current.draft!.weeks;
    const incoming = makeRestWeek(0);

    act(() => result.current.insertWeekAfter(w0.uid, incoming));
    const draft = result.current.draft!;
    expect(result.current.isDirty).toBe(true);
    expect(draft.weeks).toHaveLength(3);
    expect(draft.weeks[1].uid).toBe(incoming.uid);
    expect(draft.weeks.map((w) => w.weekIndex)).toEqual([0, 1, 2]);
  });

  it("insertWeekAfter no-ops (not dirty) at MAX_WEEKS, on a missing source uid, and on a reused week uid", () => {
    const capped = renderHook(() => useProgramBuilderState());
    act(() => capped.result.current.seed(makeDraft(MAX_WEEKS)));
    act(() =>
      capped.result.current.insertWeekAfter(
        capped.result.current.draft!.weeks[0].uid,
        makeRestWeek(0),
      ),
    );
    expect(capped.result.current.draft!.weeks).toHaveLength(MAX_WEEKS);
    expect(capped.result.current.isDirty).toBe(false);

    const { result } = setup(2);
    act(() => result.current.insertWeekAfter("wk-vanished", makeRestWeek(0)));
    expect(result.current.draft!.weeks).toHaveLength(2);
    expect(result.current.isDirty).toBe(false);

    // A week object whose uid is already in the tree (stale double-commit) no-ops.
    const existing = result.current.draft!.weeks[1];
    act(() => result.current.insertWeekAfter(result.current.draft!.weeks[0].uid, existing));
    expect(result.current.draft!.weeks).toHaveLength(2);
    expect(result.current.isDirty).toBe(false);
  });

  it("insertWeekAfter normalizes an incoming setSpecs: [] to null (backstop)", () => {
    const { result } = setup(1);
    const w0 = result.current.draft!.weeks[0];
    act(() => result.current.addSessionToSlot(w0.days[0].uid));
    act(() => {
      const source = result.current.draft!.weeks[0];
      const incoming = makeRestWeek(0);
      incoming.days[0] = {
        ...incoming.days[0],
        isRest: false,
        session: {
          uid: "sess-in",
          name: "Incoming",
          focus: null,
          estimatedDurationMinutes: null,
          calorieSurplusPercentage: null,
          notes: null,
          sessionType: "training",
          exercises: [
            {
              uid: "ex-in",
              exerciseId: null,
              name: "Row",
              setSpecs: [],
              sets: 3,
              repsMin: 8,
              repsMax: 10,
              repsTarget: null,
              rpeTarget: null,
              percentage1rm: null,
              tempo: null,
              restSeconds: null,
              supersetGroup: null,
              isWarmup: false,
              notes: null,
              videoUrl: null,
              prescribedFields: null,
            },
          ],
        },
      };
      result.current.insertWeekAfter(source.uid, incoming);
    });
    expect(sessionAt(result.current.draft!, 1, 0)!.exercises[0].setSpecs).toBeNull();
  });

  it("deleteWeek is a no-op at one week (min-1 invariant)", () => {
    const { result } = setup(1);
    act(() => result.current.deleteWeek(result.current.draft!.weeks[0].uid));
    expect(result.current.draft!.weeks).toHaveLength(1);
  });

  it("deleteWeek and reorderWeek renumber weekIndex", () => {
    const { result } = setup(3);
    const [w0, w1, w2] = result.current.draft!.weeks;
    act(() => result.current.addSessionToSlot(w2.days[0].uid));

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
  it("addSessionToSlot fills a rest slot; clearSlot reverts it to rest", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[2];

    act(() => result.current.addSessionToSlot(slot.uid));
    let updated = result.current.draft!.weeks[0].days[2];
    expect(updated.isRest).toBe(false);
    expect(updated.session!.name).toBe("Day 3");

    // Adding onto an occupied slot is a no-op.
    const uid = updated.session!.uid;
    act(() => result.current.addSessionToSlot(slot.uid));
    expect(result.current.draft!.weeks[0].days[2].session!.uid).toBe(uid);

    act(() => result.current.clearSlot(slot.uid));
    updated = result.current.draft!.weeks[0].days[2];
    expect(updated.isRest).toBe(true);
    expect(updated.session).toBeNull();
  });

  it("moveSession to a rest slot moves (source becomes rest)", () => {
    const { result } = setup(2);
    const source = result.current.draft!.weeks[0].days[0];
    act(() => result.current.addSessionToSlot(source.uid));
    const sessionUid = result.current.draft!.weeks[0].days[0].session!.uid;
    const target = result.current.draft!.weeks[1].days[6];

    act(() => result.current.moveSession(sessionUid, target.uid));
    const draft = result.current.draft!;
    expect(sessionAt(draft, 0, 0)).toBeNull();
    expect(draft.weeks[0].days[0].isRest).toBe(true);
    expect(sessionAt(draft, 1, 6)!.uid).toBe(sessionUid);
    expect(draft.weeks[1].days[6].isRest).toBe(false);
  });

  it("moveSession onto an occupied slot swaps the two sessions", () => {
    const { result } = setup(1);
    const [a, b] = [
      result.current.draft!.weeks[0].days[0],
      result.current.draft!.weeks[0].days[3],
    ];
    act(() => result.current.addSessionToSlot(a.uid));
    act(() => result.current.addSessionToSlot(b.uid));
    const uidA = sessionAt(result.current.draft!, 0, 0)!.uid;
    const uidB = sessionAt(result.current.draft!, 0, 3)!.uid;

    act(() => result.current.moveSession(uidA, b.uid));
    const draft = result.current.draft!;
    expect(sessionAt(draft, 0, 0)!.uid).toBe(uidB);
    expect(sessionAt(draft, 0, 3)!.uid).toBe(uidA);
    // Slots stayed put; orderIndex/isRest still consistent.
    expect(draft.weeks[0].days.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(draft.weeks[0].days.map((s) => s.isRest)).toEqual([
      false, true, true, false, true, true, true,
    ]);
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
    exercises: [],
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

  it("occupied slots are a clean no-op (one session per day-cell)", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[0];
    act(() => result.current.addSessionToSlot(slot.uid));
    const original = sessionAt(result.current.draft!, 0, 0);

    // Reset dirty via a save snapshot so the no-op assertion is clean.
    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    act(() => result.current.placeSession(slot.uid, makeLibraryClone()));

    expect(sessionAt(result.current.draft!, 0, 0)).toBe(original);
    expect(result.current.isDirty).toBe(false);
  });

  it("addSessionToSlot accepts a custom name (create-blank flow)", () => {
    const { result } = setup(1);
    const slot = result.current.draft!.weeks[0].days[4];
    act(() => result.current.addSessionToSlot(slot.uid, "Untitled session"));
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
    supersetGroup: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: null,
  };

  it("add/update/remove exercise via session uid", () => {
    const { result } = setup(1);
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid));
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;

    act(() => result.current.addExercise(sessionUid, baseExercise));
    let session = findSession(result.current.draft, sessionUid)!;
    expect(session.exercises).toHaveLength(1);
    const exUid = session.exercises[0].uid;

    act(() => result.current.updateExercise(sessionUid, exUid, { name: "Incline Bench" }));
    session = findSession(result.current.draft, sessionUid)!;
    expect(session.exercises[0].name).toBe("Incline Bench");

    act(() => result.current.removeExercise(sessionUid, exUid));
    expect(findSession(result.current.draft, sessionUid)!.exercises).toHaveLength(0);
  });

  it("normalize reverts an empty setSpecs array to null (never serialize [])", () => {
    const { result } = setup(1);
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid));
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;
    act(() => result.current.addExercise(sessionUid, baseExercise));
    const exUid = findSession(result.current.draft, sessionUid)!.exercises[0].uid;

    act(() => result.current.updateExercise(sessionUid, exUid, { setSpecs: [] }));
    expect(findSession(result.current.draft, sessionUid)!.exercises[0].setSpecs).toBeNull();
  });

  it("normalize renumbers set_number after spec updates", () => {
    const { result } = setup(1);
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid));
    const sessionUid = sessionAt(result.current.draft!, 0, 0)!.uid;
    act(() => result.current.addExercise(sessionUid, baseExercise));
    const exUid = findSession(result.current.draft, sessionUid)!.exercises[0].uid;

    act(() =>
      result.current.updateExercise(sessionUid, exUid, {
        setSpecs: [
          { set_number: 9, set_type: "warmup" },
          { set_number: 9, set_type: "working" },
        ],
      }),
    );
    const specs = findSession(result.current.draft, sessionUid)!.exercises[0].setSpecs!;
    expect(specs.map((s) => s.set_number)).toEqual([1, 2]);
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
    act(() => result.current.addSessionToSlot(slot.uid));
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.markSaved(result.current.getRevision());
    });
    expect(result.current.isDirty).toBe(false);

    const sessionUid = result.current.draft!.weeks[0].days[0].session!.uid;
    // Self-drop (drag released over its own slot).
    act(() => result.current.moveSession(sessionUid, slot.uid));
    // Blur-without-change commits.
    act(() => result.current.updateSession(sessionUid, { name: "Day 1" }));
    act(() => result.current.setName("P"));
    act(() => result.current.setDescription(null));
    act(() => result.current.setDefaultSurplus(null));
    // Add onto an occupied slot.
    act(() => result.current.addSessionToSlot(slot.uid));
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
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid));

    // Snapshot taken at save time; an edit lands while the save is in flight.
    const revision = result.current.getRevision();
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[1].uid));

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
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid));
    const sessionUid = result.current.draft!.weeks[0].days[0].session!.uid;

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
    expect(result.current.draft!.weeks[0].days[0].session!.notes).toBe("from the assistant");
    // One bump for the whole turn — markSaved semantics identical to a hand edit.
    expect(result.current.getRevision()).toBe(before + 1);
    expect(result.current.isDirty).toBe(true);
  });

  it("replaceDraft restores a snapshot THROUGH apply (revision moves — the markSaved race is closed)", () => {
    const { result } = setup(1);
    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[0].uid));
    const snapshot = result.current.getDraft()!;
    const wasDirty = result.current.getDirty();

    act(() => result.current.addSessionToSlot(result.current.draft!.weeks[0].days[1].uid));
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
    expect(result.current.draft!.weeks[0].days[1].session).toBeNull(); // restored tree
    expect(result.current.draft!.weeks[0].days[0].session).not.toBeNull();
  });
});
