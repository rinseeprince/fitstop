import { describe, it, expect } from "vitest";
import { habitCellState, isDayEditable } from "./habit-cell-state";
import type { HabitDayFacts } from "@/types/habits";

const TODAY = "2026-09-30";

function day(over: Partial<HabitDayFacts> & { date: string }): HabitDayFacts {
  return {
    covered: true,
    planned: true,
    target: null,
    edited: false,
    versionId: "v1",
    timesPerWeek: null,
    entry: null,
    met: false,
    ...over,
  };
}

describe("habitCellState — a tracker day read from the kernel's facts", () => {
  it("is done when the day was met: a tick, or a number at its target", () => {
    expect(habitCellState(day({ date: "2026-09-28", entry: { done: true, value: null, note: null }, met: true }), TODAY)).toBe("done");
    expect(habitCellState(day({ date: TODAY, target: 3, entry: { done: null, value: 3.2, note: null }, met: true }), TODAY)).toBe("done");
  });

  it("is missed for a planned day gone by that was not met: no entry, not done, or a number short", () => {
    expect(habitCellState(day({ date: "2026-09-29" }), TODAY)).toBe("missed");
    expect(habitCellState(day({ date: "2026-09-28", entry: { done: false, value: null, note: null } }), TODAY)).toBe("missed");
    expect(habitCellState(day({ date: "2026-09-28", target: 3, entry: { done: null, value: 2, note: null } }), TODAY)).toBe("missed");
  });

  // Today is still open: 1.5 L of 3 at lunch, or a tick taken back, is not a
  // miss yet, any more than a habit not touched at all.
  it("is pending for today, planned and not met yet — nothing entered, unticked, or a number short so far", () => {
    expect(habitCellState(day({ date: TODAY }), TODAY)).toBe("pending");
    expect(habitCellState(day({ date: TODAY, entry: { done: false, value: null, note: null } }), TODAY)).toBe("pending");
    expect(habitCellState(day({ date: TODAY, target: 3, entry: { done: null, value: 1.5, note: null } }), TODAY)).toBe("pending");
  });

  it("is blank with nothing to judge: no version, a day not planned and not met", () => {
    expect(habitCellState(day({ date: "2026-09-28", covered: false, entry: { done: true, value: null, note: null } }), TODAY)).toBe("blank");
    expect(habitCellState(day({ date: "2026-09-28", planned: false }), TODAY)).toBe("blank");
    // A times-a-week habit plans no day: blank unless the client met it that day.
    expect(habitCellState(day({ date: "2026-09-28", planned: false, timesPerWeek: 3 }), TODAY)).toBe("blank");
  });

  // A coach paging forward plans one-date changes: the days still to come
  // show which are planned, and a day ahead that is not planned stays blank.
  it("is ahead for a planned day after today, and blank for one not planned or no version covers", () => {
    expect(habitCellState(day({ date: "2026-10-01" }), TODAY)).toBe("ahead");
    expect(habitCellState(day({ date: "2026-10-01", planned: false }), TODAY)).toBe("blank");
    expect(habitCellState(day({ date: "2026-10-01", covered: false, planned: false }), TODAY)).toBe("blank");
    expect(habitCellState(day({ date: "2026-10-01", planned: false, timesPerWeek: 3 }), TODAY)).toBe("blank");
  });

  // The review's rule: only a planned day can be missed.
  it("is blank for a day not planned and not met even with an entry, today included", () => {
    expect(habitCellState(day({ date: "2026-09-28", planned: false, target: 3, entry: { done: null, value: 1, note: null } }), TODAY)).toBe("blank");
    expect(habitCellState(day({ date: "2026-09-28", planned: false, entry: { done: false, value: null, note: null } }), TODAY)).toBe("blank");
    expect(habitCellState(day({ date: TODAY, planned: false, timesPerWeek: 3, entry: { done: false, value: null, note: null } }), TODAY)).toBe("blank");
  });
});

describe("isDayEditable — the days \"This day\" opens on", () => {
  it("is a set-days habit's covered day from today on, planned or not", () => {
    expect(isDayEditable(day({ date: TODAY }), TODAY)).toBe(true);
    expect(isDayEditable(day({ date: "2026-10-06", planned: false }), TODAY)).toBe(true);
  });

  it("is never a day gone by, a day no version covers, or a day of a habit done a number of times a week", () => {
    expect(isDayEditable(day({ date: "2026-09-29" }), TODAY)).toBe(false);
    expect(isDayEditable(day({ date: "2026-10-06", covered: false, planned: false }), TODAY)).toBe(false);
    expect(isDayEditable(day({ date: "2026-10-06", planned: false, timesPerWeek: 3 }), TODAY)).toBe(false);
  });
});
