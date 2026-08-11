import { describe, it, expect } from "vitest";
import {
  deriveBlockState,
  deriveWeekOfTotal,
  derivePace,
} from "./block-derivations";

// Pure string/UTC math — exact assertions hold under any server timezone.

// A 6-week block: 42 days inclusive.
const BLOCK = { startsOn: "2026-08-11", endsOn: "2026-09-21" };

describe("deriveBlockState", () => {
  it("walks future → current → past across the boundary days", () => {
    expect(deriveBlockState(BLOCK, "2026-08-10")).toBe("future");
    expect(deriveBlockState(BLOCK, "2026-08-11")).toBe("current"); // first day
    expect(deriveBlockState(BLOCK, "2026-09-21")).toBe("current"); // last day
    expect(deriveBlockState(BLOCK, "2026-09-22")).toBe("past"); // day after
  });
});

describe("deriveWeekOfTotal", () => {
  it("is null unless the block contains today", () => {
    expect(deriveWeekOfTotal(BLOCK, "2026-08-10")).toBeNull();
    expect(deriveWeekOfTotal(BLOCK, "2026-09-22")).toBeNull();
  });

  it("counts weeks from the block's own start", () => {
    expect(deriveWeekOfTotal(BLOCK, "2026-08-11")).toEqual({ current: 1, total: 6 });
    expect(deriveWeekOfTotal(BLOCK, "2026-08-17")).toEqual({ current: 1, total: 6 }); // day 7
    expect(deriveWeekOfTotal(BLOCK, "2026-08-18")).toEqual({ current: 2, total: 6 }); // day 8
    expect(deriveWeekOfTotal(BLOCK, "2026-09-21")).toEqual({ current: 6, total: 6 }); // day 42
  });

  it("stays week-accurate across a DST boundary", () => {
    // 2 weeks spanning the US spring-forward (2026-03-08).
    const dst = { startsOn: "2026-03-02", endsOn: "2026-03-15" };
    expect(deriveWeekOfTotal(dst, "2026-03-08")).toEqual({ current: 1, total: 2 });
    expect(deriveWeekOfTotal(dst, "2026-03-09")).toEqual({ current: 2, total: 2 });
  });

  it("agrees with the weeks field on a truncated block (ceil, one derivation)", () => {
    // 29 days — truncated in week 5; its final day reads week 5 of 5.
    const truncated = { startsOn: "2026-07-13", endsOn: "2026-08-10" };
    expect(deriveWeekOfTotal(truncated, "2026-08-10")).toEqual({
      current: 5,
      total: 5,
    });
  });
});

describe("derivePace", () => {
  const paceInputs = {
    ...BLOCK,
    targetWeight: 85,
    startWeight: 92,
    currentWeight: 88,
    today: "2026-08-11",
  };

  it("returns null — never a fabricated zero — when any weight is missing", () => {
    expect(derivePace({ ...paceInputs, targetWeight: null })).toBeNull();
    expect(derivePace({ ...paceInputs, startWeight: null })).toBeNull();
    expect(derivePace({ ...paceInputs, currentWeight: null })).toBeNull();
  });

  it("expects the start weight on day one and the target on the last day", () => {
    const dayOne = derivePace(paceInputs);
    expect(dayOne?.expected).toBe(92);
    expect(dayOne?.delta).toBe(88 - 92);

    const lastDay = derivePace({ ...paceInputs, today: "2026-09-21" });
    expect(lastDay?.expected).toBe(85);
  });

  it("interpolates linearly and reports raw, unrounded numbers", () => {
    // Bang on the middle of the 41-day span: 2026-08-11 + 20.5 has no exact
    // day, so use a 42-day block where day 22 sits at fraction 21/41.
    const mid = derivePace({ ...paceInputs, today: "2026-09-01" });
    // elapsed 21 of 41 days: 92 + (85 − 92) × 21/41
    expect(mid?.expected).toBeCloseTo(92 - 7 * (21 / 41), 10);
    expect(mid?.remaining).toBe(3); // 88 − 85, positive = above target
    expect(mid?.delta).toBeCloseTo(88 - (92 - 7 * (21 / 41)), 10);
  });

  it("reports fractional weeksLeft with no rounding", () => {
    expect(derivePace(paceInputs)?.weeksLeft).toBe(6); // 42 days / 7
    expect(derivePace({ ...paceInputs, today: "2026-09-21" })?.weeksLeft).toBe(1 / 7);
  });

  it("clamps out-of-window callers to the line's endpoints", () => {
    const afterEnd = derivePace({ ...paceInputs, today: "2026-10-01" });
    expect(afterEnd?.expected).toBe(85); // fraction clamps to 1
    expect(afterEnd?.weeksLeft).toBe(0); // never negative

    const beforeStart = derivePace({ ...paceInputs, today: "2026-08-01" });
    expect(beforeStart?.expected).toBe(92); // fraction clamps to 0
  });

  it("treats a single-day window as fully elapsed rather than dividing by zero", () => {
    const singleDay = derivePace({
      ...paceInputs,
      startsOn: "2026-08-11",
      endsOn: "2026-08-11",
    });
    expect(singleDay?.expected).toBe(85);
  });

  it("is unit-agnostic — same math in any one unit system", () => {
    const lbs = derivePace({
      ...paceInputs,
      targetWeight: 187.4,
      startWeight: 202.8,
      currentWeight: 194,
    });
    expect(lbs?.remaining).toBeCloseTo(194 - 187.4, 10);
    expect(lbs?.expected).toBe(202.8); // day one
  });
});
