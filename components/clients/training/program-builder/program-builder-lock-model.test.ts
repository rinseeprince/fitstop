import { describe, it, expect } from "vitest";
import {
  LIMIT_LOCKED,
  PAST_LOCKED,
  insertWeekRefusal,
  isSessionLocked,
  moveWeekRefusal,
  planDayRules,
  sessionRefusal,
  slotRefusal,
} from "./program-builder-lock-model";
import {
  DAYS_PER_WEEK,
  type DaySlotDraft,
  type ProgramDraft,
  type SessionDraft,
  type WeekDraft,
} from "./program-builder-types";

// Deterministic fixtures (no newUid) so assertions can name uids directly:
// week w is `wk-w`, and the slot at position p — the plan's day
// effective_from + p — is `s<p>`, holding session `sess-<p>` when it has one
// (and `sess-<p>-2` after it when it holds two).

function sess(uid: string): SessionDraft {
  return {
    uid,
    name: "S",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [],
  };
}

function slot(uid: string, orderIndex: number, sessions: SessionDraft[] = []): DaySlotDraft {
  return { uid, orderIndex, isRest: sessions.length === 0, sessions };
}

function makeWeeks(count: number, sessionsAt: number[] = [], twoAt: number[] = []): WeekDraft[] {
  return Array.from({ length: count }, (_, w) => ({
    uid: `wk-${w}`,
    weekIndex: w,
    days: Array.from({ length: DAYS_PER_WEEK }, (_, d) => {
      const position = w * DAYS_PER_WEEK + d;
      const sessions = sessionsAt.includes(position) ? [sess(`sess-${position}`)] : [];
      if (twoAt.includes(position)) sessions.push(sess(`sess-${position}`), sess(`sess-${position}-2`));
      return slot(`s${position}`, d, sessions);
    }),
  }));
}

/** A rest week to insert, or one with a session on `sessionDay`. */
function newWeek(sessionDay: number | null = null): WeekDraft {
  return {
    uid: "wk-new",
    weekIndex: 0,
    days: Array.from({ length: DAYS_PER_WEEK }, (_, d) =>
      slot(`new-${d}`, d, d === sessionDay ? [sess("sess-new")] : []),
    ),
  };
}

/** The slot uids from position `from` through `to`. */
function slots(from: number, to: number): Set<string> {
  return new Set(Array.from({ length: to - from + 1 }, (_, i) => `s${from + i}`));
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

describe("planDayRules", () => {
  it("splits the grid by position: history before `from`, greyed after `through`", () => {
    const rules = planDayRules(makeWeeks(3), { from: 9, through: 16 }, null);
    expect(rules.past).toEqual(slots(0, 8));
    expect(rules.beyond).toEqual(slots(17, 20));
    expect(rules.locked).toEqual(new Set([...slots(0, 8), ...slots(17, 20)]));
  });

  it("greys nothing when nothing bounds the plan", () => {
    const rules = planDayRules(makeWeeks(2), { from: 3, through: null }, null);
    expect(rules.beyond.size).toBe(0);
    expect(rules.locked).toEqual(slots(0, 2));
  });

  it("has no history when the first editable day is the plan's first day", () => {
    const rules = planDayRules(makeWeeks(2), { from: 0, through: null }, null);
    expect(rules.past.size).toBe(0);
    expect(rules.locked.size).toBe(0);
  });

  it("rings today's slot, even when today is already history; null off the grid", () => {
    const weeks = makeWeeks(2);
    expect(planDayRules(weeks, { from: 7, through: null }, 7).todaySlotUid).toBe("s7");
    // A workout logged today moves the first editable day to tomorrow.
    const logged = planDayRules(weeks, { from: 7, through: null }, 6);
    expect(logged.todaySlotUid).toBe("s6");
    expect(logged.past.has("s6")).toBe(true);
    expect(planDayRules(weeks, { from: 7, through: null }, null).todaySlotUid).toBeNull();
    expect(planDayRules(weeks, { from: 7, through: null }, 14).todaySlotUid).toBeNull();
  });

  it("reads the grid as it stands: a moved week takes the rule of its new place", () => {
    const [first, second] = makeWeeks(2);
    const rules = planDayRules([second, first], { from: 7, through: null }, null);
    expect(rules.past).toEqual(new Set(second.days.map((s) => s.uid)));
    expect(first.days.some((s) => rules.locked.has(s.uid))).toBe(false);
  });

  it("allows Add week only while the next week's first day is inside the limit", () => {
    // Two weeks: the next week would start on position 14.
    const weeks = makeWeeks(2);
    expect(planDayRules(weeks, { from: 0, through: 13 }, null).canAddWeek).toBe(false);
    expect(planDayRules(weeks, { from: 0, through: 14 }, null).canAddWeek).toBe(true);
    expect(planDayRules(weeks, { from: 0, through: null }, null).canAddWeek).toBe(true);
  });

  describe("week actions", () => {
    it("refuses delete for any week holding a history day; a greyed week can go", () => {
      // from 9: week 0 is all history and week 1 holds days 7-8; 17-20 greyed.
      const rules = planDayRules(makeWeeks(3), { from: 9, through: 16 }, null);
      expect(rules.weeks.get("wk-0")?.canDelete).toBe(false);
      expect(rules.weeks.get("wk-1")?.canDelete).toBe(false);
      expect(rules.weeks.get("wk-2")?.canDelete).toBe(true);
    });

    it("refuses duplicate before the last history week and when the copy pushes a session past the limit", () => {
      // Sessions on 3, 10 and 16; week 1 holds the last history day.
      const weeks = makeWeeks(3, [3, 10, 16]);
      const open = planDayRules(weeks, { from: 9, through: null }, null);
      expect(open.weeks.get("wk-0")?.canDuplicate).toBe(false);
      expect(open.weeks.get("wk-1")?.canDuplicate).toBe(true);
      expect(open.weeks.get("wk-2")?.canDuplicate).toBe(true);

      // The plan ends on position 20: a copy of week 1 pushes week 2's session
      // to 23.
      const capped = planDayRules(weeks, { from: 9, through: 20 }, null);
      expect(capped.weeks.get("wk-1")?.canDuplicate).toBe(false);
      // Through 23 it still reaches that day.
      const roomy = planDayRules(weeks, { from: 9, through: 23 }, null);
      expect(roomy.weeks.get("wk-1")?.canDuplicate).toBe(true);
      expect(roomy.weeks.get("wk-2")?.canDuplicate).toBe(true);
    });

    it("keeps a week touching a history or greyed day from being dragged", () => {
      const rules = planDayRules(makeWeeks(4), { from: 9, through: 23 }, null);
      expect(rules.weeks.get("wk-0")?.canReorder).toBe(false);
      expect(rules.weeks.get("wk-1")?.canReorder).toBe(false);
      expect(rules.weeks.get("wk-2")?.canReorder).toBe(true);
      // Days 24-27 are greyed.
      expect(rules.weeks.get("wk-3")?.canReorder).toBe(false);
    });
  });
});

describe("slotRefusal", () => {
  it("names why a slot is locked, and nothing for an editable or unknown slot", () => {
    const rules = planDayRules(makeWeeks(2), { from: 3, through: 10 }, null);
    expect(slotRefusal(rules, "s2")).toBe(PAST_LOCKED);
    expect(slotRefusal(rules, "s3")).toBeNull();
    expect(slotRefusal(rules, "s10")).toBeNull();
    expect(slotRefusal(rules, "s11")).toBe(LIMIT_LOCKED);
    expect(slotRefusal(rules, "s-gone")).toBeNull();
  });
});

describe("session queries", () => {
  // Sessions on a history day (1), an editable day (5) and a greyed day (12).
  const draft = draftWith(makeWeeks(2, [1, 5, 12]));
  const rules = planDayRules(draft.weeks, { from: 3, through: 10 }, null);

  it("sessionRefusal resolves through the slot holding the session", () => {
    expect(sessionRefusal(draft, rules, "sess-1")).toBe(PAST_LOCKED);
    expect(sessionRefusal(draft, rules, "sess-5")).toBeNull();
    expect(sessionRefusal(draft, rules, "sess-12")).toBe(LIMIT_LOCKED);
    expect(sessionRefusal(draft, rules, "sess-gone")).toBeNull();
  });

  it("isSessionLocked is true exactly when the session's slot is locked", () => {
    expect(isSessionLocked(draft, rules.locked, "sess-1")).toBe(true);
    expect(isSessionLocked(draft, rules.locked, "sess-5")).toBe(false);
    expect(isSessionLocked(draft, rules.locked, "sess-12")).toBe(true);
    expect(isSessionLocked(draft, rules.locked, "sess-gone")).toBe(false);
  });

  it("finds a day's second session through its day's list", () => {
    // Two sessions on a history day (2) and on an editable day (6).
    const twoADay = draftWith(makeWeeks(2, [], [2, 6]));
    const twoRules = planDayRules(twoADay.weeks, { from: 3, through: 10 }, null);
    expect(sessionRefusal(twoADay, twoRules, "sess-2-2")).toBe(PAST_LOCKED);
    expect(sessionRefusal(twoADay, twoRules, "sess-6-2")).toBeNull();
    expect(isSessionLocked(twoADay, twoRules.locked, "sess-2-2")).toBe(true);
    expect(isSessionLocked(twoADay, twoRules.locked, "sess-6-2")).toBe(false);
  });
});

describe("insertWeekRefusal", () => {
  it("refuses an insert before the last history week", () => {
    const weeks = makeWeeks(3);
    // from 9: week 1 holds the last history days (7-8).
    const days = { from: 9, through: null };
    expect(insertWeekRefusal(weeks, days, 0, newWeek())).toBe(PAST_LOCKED);
    expect(insertWeekRefusal(weeks, days, 1, newWeek())).toBeNull();
    expect(insertWeekRefusal(weeks, days, 2, newWeek())).toBeNull();
    // History ending on a week's last day: that week is the last history week.
    expect(insertWeekRefusal(weeks, { from: 7, through: null }, 0, newWeek())).toBeNull();
  });

  it("refuses an insert that pushes a session past the plan's last day", () => {
    // A session on 15; the plan reaches position 21.
    const weeks = makeWeeks(3, [15]);
    const days = { from: 0, through: 21 };
    // After week 1, week 2 moves on a week and its session to 22.
    expect(insertWeekRefusal(weeks, days, 1, newWeek())).toBe(LIMIT_LOCKED);
    // Appended after the last week, a rest week pushes nothing.
    expect(insertWeekRefusal(weeks, days, 2, newWeek())).toBeNull();
  });

  it("refuses a week that would start past the plan's limit — the Add week rule", () => {
    // Three weeks end on position 20; an appended week starts on 21.
    const weeks = makeWeeks(3);
    expect(insertWeekRefusal(weeks, { from: 0, through: 20 }, 2, newWeek())).toBe(LIMIT_LOCKED);
    expect(insertWeekRefusal(weeks, { from: 0, through: 21 }, 2, newWeek())).toBeNull();
    // So the last week can't be copied once the grid reaches the limit.
    const rules = planDayRules(weeks, { from: 0, through: 20 }, null);
    expect(rules.canAddWeek).toBe(false);
    expect(rules.weeks.get(weeks[2].uid)?.canDuplicate).toBe(false);
  });

  it("counts the start from where the week lands, not from the grid's end", () => {
    // After week 0 the new week starts on 7.
    const weeks = makeWeeks(2);
    expect(insertWeekRefusal(weeks, { from: 0, through: 6 }, 0, newWeek())).toBe(LIMIT_LOCKED);
    expect(insertWeekRefusal(weeks, { from: 0, through: 7 }, 0, newWeek())).toBeNull();
  });

  it("refuses an appended week whose own session lands past the limit", () => {
    // Appended to three weeks, the new week covers 21-27 and the plan reaches
    // 22: it starts inside the limit, so its own session decides.
    const weeks = makeWeeks(3);
    expect(insertWeekRefusal(weeks, { from: 0, through: 22 }, 2, newWeek(3))).toBe(LIMIT_LOCKED);
    expect(insertWeekRefusal(weeks, { from: 0, through: 22 }, 2, newWeek(1))).toBeNull();
    expect(insertWeekRefusal(weeks, { from: 0, through: null }, 2, newWeek(3))).toBeNull();
  });
});

describe("moveWeekRefusal", () => {
  it("refuses a move from or onto the last history week or any before it", () => {
    const weeks = makeWeeks(4);
    // from 9: week 1 is the last history week.
    const days = { from: 9, through: null };
    expect(moveWeekRefusal(weeks, days, 0, 3)).toBe(PAST_LOCKED);
    expect(moveWeekRefusal(weeks, days, 1, 3)).toBe(PAST_LOCKED);
    expect(moveWeekRefusal(weeks, days, 3, 1)).toBe(PAST_LOCKED);
    expect(moveWeekRefusal(weeks, days, 3, 2)).toBeNull();
    expect(moveWeekRefusal(weeks, days, 2, 3)).toBeNull();
  });

  it("refuses a move that lands a session past the plan's last day", () => {
    // A session on 8 (week 1); the plan reaches position 20.
    const weeks = makeWeeks(4, [8]);
    const days = { from: 0, through: 20 };
    // To the last week: the session lands on 22.
    expect(moveWeekRefusal(weeks, days, 1, 3)).toBe(LIMIT_LOCKED);
    // One week on: 15.
    expect(moveWeekRefusal(weeks, days, 1, 2)).toBeNull();
  });

  it("refuses a move that lands a day holding several sessions past the plan's last day", () => {
    // Two sessions on 8 and nothing else; the plan reaches position 20.
    const weeks = makeWeeks(4, [], [8]);
    expect(moveWeekRefusal(weeks, { from: 0, through: 20 }, 1, 3)).toBe(LIMIT_LOCKED);
  });
});

describe("refusal copy", () => {
  it("is two different plain sentences (shared by ops skips, toasts and the assistant)", () => {
    expect(PAST_LOCKED).toMatch(/locked/);
    expect(LIMIT_LOCKED).toMatch(/greyed out/);
    expect(PAST_LOCKED).not.toBe(LIMIT_LOCKED);
  });
});
