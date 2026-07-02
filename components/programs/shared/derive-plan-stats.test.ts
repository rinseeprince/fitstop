import { describe, it, expect } from "vitest";
import {
  abbreviateFocus,
  getMode,
  getPerWeek,
  getRestCount,
  getTotalSlots,
  getTrainingCount,
  getWeekCount,
} from "./derive-plan-stats";
import { formatRelativeUpdated } from "./format-relative";
import type { SavedPlan } from "@/types/training";

function makePlan(
  sessions: Array<{ weekIndex: number; isRest: boolean }>
): SavedPlan {
  return {
    sessions: sessions.map((s, i) => ({
      ...s,
      id: `s${i}`,
      orderIndex: i,
    })),
  } as unknown as SavedPlan;
}

describe("derive-plan-stats", () => {
  const plan = makePlan([
    { weekIndex: 0, isRest: false },
    { weekIndex: 0, isRest: true },
    { weekIndex: 1, isRest: false },
    { weekIndex: 1, isRest: false },
  ]);

  it("derives week/slot/training/rest counts", () => {
    expect(getWeekCount(plan)).toBe(2);
    expect(getTotalSlots(plan)).toBe(4);
    expect(getTrainingCount(plan)).toBe(3);
    expect(getRestCount(plan)).toBe(1);
  });

  it("derives per-week average to one decimal", () => {
    expect(getPerWeek(plan)).toBe(1.5);
  });

  it("handles empty session lists", () => {
    const empty = makePlan([]);
    expect(getWeekCount(empty)).toBe(1);
    expect(getPerWeek(empty)).toBe(0);
  });

  it("abbreviates long focus strings to initials", () => {
    expect(abbreviateFocus("push pull legs")).toBe("PPL");
    expect(abbreviateFocus("strength")).toBe("strength");
  });

  it("finds the mode of a derived field", () => {
    const items = [{ v: "a" }, { v: "b" }, { v: "a" }, { v: null }];
    expect(getMode(items, (i) => i.v)).toEqual({ value: "a", count: 2 });
    expect(getMode([], () => null)).toBeNull();
  });
});

describe("formatRelativeUpdated", () => {
  const now = new Date("2026-07-02T12:00:00Z");

  it.each([
    ["2026-07-02T11:59:40Z", "just now"],
    ["2026-07-02T11:30:00Z", "30m ago"],
    ["2026-07-02T06:00:00Z", "6h ago"],
    ["2026-06-30T12:00:00Z", "2d ago"],
    ["2026-06-18T12:00:00Z", "2w ago"],
    ["2026-04-20T12:00:00Z", "2mo ago"],
    ["2024-06-01T12:00:00Z", "2y ago"],
  ])("formats %s as %s", (iso, expected) => {
    expect(formatRelativeUpdated(iso, now)).toBe(expected);
  });

  it("returns a dash for invalid dates", () => {
    expect(formatRelativeUpdated("not-a-date", now)).toBe("—");
  });
});
