import { describe, it, expect } from "vitest";
import {
  PAST_LOCKED,
  computeLockedSlotUids,
  isSlotLocked,
  isSessionLocked,
  weekLockState,
  lockBoundaryWeekIndex,
  canDeleteWeek,
  canDuplicateWeek,
  canInsertAfterWeek,
  canReorderWeeks,
  type PlacedPlanLockSource,
} from "./program-builder-lock-model";
import {
  DAYS_PER_WEEK,
  type DaySlotDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";

// Deterministic fixtures (no newUid) so assertions can name uids directly.

function sess(uid: string): SessionDraft {
  return {
    uid,
    name: "S",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [],
  };
}

function slot(uid: string, orderIndex: number, session: SessionDraft | null = null): DaySlotDraft {
  return { uid, orderIndex, isRest: session == null, session };
}

function makeWeeks(count: number): WeekDraft[] {
  return Array.from({ length: count }, (_, w) => ({
    uid: `wk-${w}`,
    weekIndex: w,
    days: Array.from({ length: DAYS_PER_WEEK }, (_, d) =>
      slot(`s${w * DAYS_PER_WEEK + d}`, d),
    ),
  }));
}

function makeSource(overrides: Partial<PlacedPlanLockSource> = {}): PlacedPlanLockSource {
  return {
    plan: { effectiveFrom: "2026-07-15" },
    clientToday: "2026-07-22",
    sessions: Array.from({ length: 14 }, () => ({ events: [] })),
    ...overrides,
  };
}

function draftWith(weeks: WeekDraft[]): ProgramDraft {
  return {
    id: "plan-1",
    name: "P",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks,
  };
}

describe("computeLockedSlotUids", () => {
  it("locks every slot whose date already happened; today stays open", () => {
    const weeks = makeWeeks(2);
    const locked = computeLockedSlotUids(makeSource(), weeks);
    // 07-15..07-21 = positions 0..6 locked; position 7 (07-22) IS today → open.
    expect(locked).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
  });

  it("locks a future slot whose linked event already left the scheduled state", () => {
    const weeks = makeWeeks(2);
    const source = makeSource();
    source.sessions[9] = { events: [{ status: "completed" }] };
    const locked = computeLockedSlotUids(source, weeks);
    expect(locked).toContain("s9");
    // A future slot with only scheduled events stays open.
    expect(locked).not.toContain("s8");
  });

  it("locks nothing for a not-yet-started plan", () => {
    const weeks = makeWeeks(2);
    const source = makeSource({ clientToday: "2026-07-10" });
    expect(computeLockedSlotUids(source, weeks)).toEqual([]);
  });

  it("tail padding (no backing row) locks by date alone", () => {
    const weeks = makeWeeks(2);
    // Only 10 backing rows; positions 10..13 are padding, dates 07-25..07-28
    // are future → open.
    const source = makeSource({ sessions: Array.from({ length: 10 }, () => ({ events: [] })) });
    const locked = computeLockedSlotUids(source, weeks);
    expect(locked).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
  });
});

describe("lock queries", () => {
  const weeks = makeWeeks(3);
  const locked = new Set(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s8"]); // wk0 full, wk1 partial

  it("isSlotLocked reads the set", () => {
    expect(isSlotLocked(locked, "s0")).toBe(true);
    expect(isSlotLocked(locked, "s9")).toBe(false);
  });

  it("isSessionLocked resolves through the slot holding the session", () => {
    const withSessions = makeWeeks(2);
    withSessions[0].days[1] = slot("s1", 1, sess("sess-past"));
    withSessions[1].days[0] = slot("s7", 0, sess("sess-future"));
    const draft = draftWith(withSessions);
    const set = new Set(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(isSessionLocked(draft, set, "sess-past")).toBe(true);
    expect(isSessionLocked(draft, set, "sess-future")).toBe(false);
    expect(isSessionLocked(draft, set, "sess-vanished")).toBe(false);
  });

  it("weekLockState classifies none / partial / full", () => {
    expect(weekLockState(weeks[0], locked)).toBe("full");
    expect(weekLockState(weeks[1], locked)).toBe("partial");
    expect(weekLockState(weeks[2], locked)).toBe("none");
  });

  it("lockBoundaryWeekIndex is the LAST week containing a locked slot", () => {
    expect(lockBoundaryWeekIndex(weeks, locked)).toBe(1);
    expect(lockBoundaryWeekIndex(weeks, new Set())).toBe(-1);
  });
});

describe("week policies", () => {
  const weeks = makeWeeks(3);
  const locked = new Set(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s8"]);

  it("canDeleteWeek: only untouched weeks", () => {
    expect(canDeleteWeek(weeks[0], locked)).toBe(false);
    expect(canDeleteWeek(weeks[1], locked)).toBe(false); // boundary (partial)
    expect(canDeleteWeek(weeks[2], locked)).toBe(true);
  });

  it("canDuplicateWeek: boundary week allowed, fully-elapsed blocked (decision 8)", () => {
    expect(canDuplicateWeek(weeks[0], locked)).toBe(false);
    expect(canDuplicateWeek(weeks[1], locked)).toBe(true);
    expect(canDuplicateWeek(weeks[2], locked)).toBe(true);
  });

  it("canInsertAfterWeek: at/after the boundary only", () => {
    expect(canInsertAfterWeek(weeks, locked, 0)).toBe(false);
    expect(canInsertAfterWeek(weeks, locked, 1)).toBe(true); // after the boundary week
    expect(canInsertAfterWeek(weeks, locked, 2)).toBe(true);
    expect(canInsertAfterWeek(weeks, new Set(), 0)).toBe(true); // nothing locked
  });

  it("canReorderWeeks: both endpoints strictly after the boundary", () => {
    const four = makeWeeks(4);
    expect(canReorderWeeks(four, locked, 2, 3)).toBe(true);
    expect(canReorderWeeks(four, locked, 3, 2)).toBe(true);
    expect(canReorderWeeks(four, locked, 1, 3)).toBe(false); // boundary week itself
    expect(canReorderWeeks(four, locked, 2, 1)).toBe(false); // landing on the boundary
    expect(canReorderWeeks(four, new Set(), 0, 3)).toBe(true);
  });
});

describe("PAST_LOCKED copy", () => {
  it("is a plain sentence (shared by ops skips, toasts, and the assistant)", () => {
    expect(PAST_LOCKED).toMatch(/locked/);
    expect(PAST_LOCKED.length).toBeGreaterThan(10);
  });
});
