import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { useLockedMutators } from "./use-locked-mutators";
import { LIMIT_LOCKED, PAST_LOCKED } from "./program-builder-lock-model";
import {
  DAYS_PER_WEEK,
  type DaySlotDraft,
  type ExerciseDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";
import type { ProgramBuilderState } from "./use-program-builder-state";

// The plan editor's manual-edit belt: every mutator asks the one date rule of
// the grid as it stands, refuses a locked or greyed day with the "Day locked"
// toast, and otherwise hands the edit to the builder state untouched.

function sess(uid: string): SessionDraft {
  return {
    uid,
    name: uid,
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [],
  };
}

const EXERCISE: Omit<ExerciseDraft, "uid"> = {
  exerciseId: null,
  name: "Row",
  setSpecs: null,
  sets: 3,
  repsMin: 8,
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

// Weeks of 7 whose slots are `s<position>`, with a session at each listed
// position — `sess<position>`, then `sess<position>b` on a day listed twice.
function weeks(count: number, sessionsAt: number[]): WeekDraft[] {
  return Array.from({ length: count }, (_, w) => ({
    uid: `w${w}`,
    weekIndex: w,
    days: Array.from({ length: DAYS_PER_WEEK }, (_, d): DaySlotDraft => {
      const position = w * DAYS_PER_WEEK + d;
      const sessions = sessionsAt
        .filter((p) => p === position)
        .map((_, i) => sess(`sess${position}${i === 0 ? "" : "b"}`));
      return { uid: `s${position}`, orderIndex: d, isRest: sessions.length === 0, sessions };
    }),
  }));
}

function fakeState(draft: ProgramDraft) {
  const calls = {
    addWeek: vi.fn(),
    placeSession: vi.fn(),
    clearSlot: vi.fn(),
    removeSession: vi.fn(),
    moveSession: vi.fn(),
    reorderSession: vi.fn(),
    updateSession: vi.fn(),
    addExercise: vi.fn(),
    removeExercise: vi.fn(),
    updateExercise: vi.fn(),
    linkExercises: vi.fn(),
    unlinkGroup: vi.fn(),
    moveExercise: vi.fn(),
    moveGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteWeek: vi.fn(),
    duplicateWeek: vi.fn(),
    reorderWeek: vi.fn(),
  };
  const state = { ...calls, getDraft: () => draft } as unknown as ProgramBuilderState;
  return { state, calls };
}

// Three weeks (positions 0-20): history before 9, the plan reaches 18. Days 2
// and 10 hold two sessions each.
const DRAFT: ProgramDraft = {
  id: "plan-1",
  name: "Plan",
  description: null,
  status: "saved",
  splitType: null,
  programDurationWeeks: 3,
  defaultSurplusPercentage: null,
  weeks: weeks(3, [2, 2, 10, 10, 16]),
};
const DAYS = { from: 9, through: 18 };

function mutators(editableDays: { from: number; through: number | null } | null = DAYS) {
  const { state, calls } = fakeState(DRAFT);
  const editSetSpec = vi.fn();
  const { result } = renderHook(() => useLockedMutators({ editableDays, state, editSetSpec }));
  return { m: result.current, calls, editSetSpec };
}

const refusedWith = (reason: string) =>
  expect(toast.error).toHaveBeenCalledWith("Day locked", { description: reason });

describe("useLockedMutators", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a day of history and a greyed day, and passes an editable one through", () => {
    const { m, calls } = mutators();

    m.placeSession("s3", sess("new"));
    refusedWith(PAST_LOCKED);
    m.placeSession("s19", sess("new"));
    refusedWith(LIMIT_LOCKED);
    expect(calls.placeSession).not.toHaveBeenCalled();

    m.placeSession("s11", sess("new"));
    expect(calls.placeSession).toHaveBeenCalledWith("s11", expect.objectContaining({ uid: "new" }));
  });

  it("refuses edits to a session on a locked day, by its slot", () => {
    const { m, calls, editSetSpec } = mutators();

    m.updateSession("sess2", { name: "x" });
    m.addExercise("sess2", EXERCISE);
    m.clearSlot("s2");
    m.moveSession("sess2", "s11");
    expect(calls.updateSession).not.toHaveBeenCalled();
    expect(calls.addExercise).not.toHaveBeenCalled();
    expect(calls.clearSlot).not.toHaveBeenCalled();
    expect(calls.moveSession).not.toHaveBeenCalled();
    expect(editSetSpec).not.toHaveBeenCalled();

    m.updateSession("sess10", { name: "x" });
    expect(calls.updateSession).toHaveBeenCalledWith("sess10", { name: "x" });
    // A move onto a greyed day is refused whatever the session.
    m.moveSession("sess10", "s20");
    expect(calls.moveSession).not.toHaveBeenCalled();
  });

  it("removeSession is refused by the day of the session it names, the day's second session too", () => {
    const { m, calls } = mutators();

    m.removeSession("sess2");
    m.removeSession("sess2b");
    refusedWith(PAST_LOCKED);
    expect(calls.removeSession).not.toHaveBeenCalled();

    m.removeSession("sess10b");
    expect(calls.removeSession).toHaveBeenCalledWith("sess10b");
    expect(calls.removeSession).toHaveBeenCalledTimes(1);
  });

  it("reorderSession is refused on a day of history, the day's second session too, and passes an editable day through", () => {
    const { m, calls } = mutators();

    m.reorderSession("sess2b", 0);
    m.reorderSession("sess2", 1);
    refusedWith(PAST_LOCKED);
    expect(calls.reorderSession).not.toHaveBeenCalled();

    m.reorderSession("sess10b", 0);
    expect(calls.reorderSession).toHaveBeenCalledWith("sess10b", 0);
    expect(calls.reorderSession).toHaveBeenCalledTimes(1);
  });

  it("refuses every group edit to a session on a locked day, and passes an editable one through", () => {
    const { m, calls } = mutators();

    m.linkExercises("sess2", ["a", "b"]);
    m.unlinkGroup("sess2", "g");
    m.moveExercise("sess2", "a", { kind: "session", index: 0 });
    m.moveGroup("sess2", "g", 0);
    m.updateGroup("sess2", "g", { rounds: 4 });
    refusedWith(PAST_LOCKED);
    for (const call of [calls.linkExercises, calls.unlinkGroup, calls.moveExercise, calls.moveGroup, calls.updateGroup]) {
      expect(call).not.toHaveBeenCalled();
    }

    m.linkExercises("sess10", ["a", "b"], "amrap");
    m.unlinkGroup("sess10", "g");
    m.moveExercise("sess10", "a", { kind: "group", groupUid: "g", index: 1 });
    m.moveGroup("sess10", "g", 2);
    m.updateGroup("sess10", "g", { notes: null });
    expect(calls.linkExercises).toHaveBeenCalledWith("sess10", ["a", "b"], "amrap");
    expect(calls.unlinkGroup).toHaveBeenCalledWith("sess10", "g");
    expect(calls.moveExercise).toHaveBeenCalledWith("sess10", "a", { kind: "group", groupUid: "g", index: 1 });
    expect(calls.moveGroup).toHaveBeenCalledWith("sess10", "g", 2);
    expect(calls.updateGroup).toHaveBeenCalledWith("sess10", "g", { notes: null });
  });

  it("refuses to delete a week holding history, and lets a later week go", () => {
    const { m, calls } = mutators();

    m.deleteWeek("w1");
    refusedWith(PAST_LOCKED);
    expect(calls.deleteWeek).not.toHaveBeenCalled();

    m.deleteWeek("w2");
    expect(calls.deleteWeek).toHaveBeenCalledWith("w2");
  });

  it("refuses a copy that would push a session past the limit, and a week past it", () => {
    const { m, calls } = mutators();

    // Copying week 1 pushes week 2's session (16) to 23, past 18.
    m.duplicateWeek("w1");
    refusedWith(LIMIT_LOCKED);
    // The grid already runs past the limit: no week can be added.
    m.addWeek();
    expect(calls.duplicateWeek).not.toHaveBeenCalled();
    expect(calls.addWeek).not.toHaveBeenCalled();
  });

  it("hands every edit to the state untouched when there are no editable days", () => {
    const { m, calls } = mutators(null);

    m.placeSession("s3", sess("new"));
    m.deleteWeek("w0");
    m.addWeek();
    m.removeSession("sess2");
    expect(calls.placeSession).toHaveBeenCalledTimes(1);
    expect(calls.deleteWeek).toHaveBeenCalledTimes(1);
    expect(calls.addWeek).toHaveBeenCalledTimes(1);
    expect(calls.removeSession).toHaveBeenCalledWith("sess2");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
