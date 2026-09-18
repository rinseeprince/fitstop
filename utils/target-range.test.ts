import { describe, expect, it } from "vitest";
import {
  clampTarget,
  formatTargetRange,
  formatTargetReadout,
  parseTargetRange,
} from "./target-range";

const RPE = { floor: 1, ceiling: 10, integer: false };
const REPS = { floor: 0, ceiling: 100, integer: true };

describe("parseTargetRange", () => {
  it("reads one value as a collapsed pair", () => {
    expect(parseTargetRange("8", RPE)).toEqual({ min: 8, max: 8 });
    expect(parseTargetRange("7.5", RPE)).toEqual({ min: 7.5, max: 7.5 });
  });

  it("reads a range, whichever dash the coach typed, and orders a reversed one", () => {
    expect(parseTargetRange("7-8", RPE)).toEqual({ min: 7, max: 8 });
    expect(parseTargetRange("7 – 8", RPE)).toEqual({ min: 7, max: 8 });
    expect(parseTargetRange("8—7", RPE)).toEqual({ min: 7, max: 8 });
    expect(parseTargetRange("100-105", { floor: 0, ceiling: 2000 })).toEqual({
      min: 100,
      max: 105,
    });
  });

  it("clamps each end into the column's bounds — a typed 0 on RPE becomes 1", () => {
    expect(parseTargetRange("0", RPE)).toEqual({ min: 1, max: 1 });
    expect(parseTargetRange("0-12", RPE)).toEqual({ min: 1, max: 10 });
    expect(parseTargetRange("150", REPS)).toEqual({ min: 100, max: 100 });
  });

  it("rounds to whole numbers where the column wants them", () => {
    expect(parseTargetRange("8.6-10.2", REPS)).toEqual({ min: 9, max: 10 });
    expect(parseTargetRange("8.6", RPE)).toEqual({ min: 8.6, max: 8.6 });
  });

  it("keeps a half-open legacy range editable", () => {
    expect(parseTargetRange("8-", REPS)).toEqual({ min: 8, max: null });
    expect(parseTargetRange("-12", REPS)).toEqual({ min: null, max: 12 });
  });

  it("an empty string is a real empty range; junk is a rejection", () => {
    expect(parseTargetRange("", RPE)).toEqual({ min: null, max: null });
    expect(parseTargetRange("   ", RPE)).toEqual({ min: null, max: null });
    expect(parseTargetRange("hard", RPE)).toBeNull();
    expect(parseTargetRange("7-8-9", RPE)).toBeNull();
    expect(parseTargetRange("7.555", RPE)).toBeNull();
  });
});

describe("formatTargetRange and formatTargetReadout", () => {
  it("collapse a single value and hyphenate a range in the box", () => {
    expect(formatTargetRange({ min: 8, max: 8 })).toBe("8");
    expect(formatTargetRange({ min: 7, max: 8 })).toBe("7-8");
    expect(formatTargetRange({ min: 8, max: null })).toBe("8-");
    expect(formatTargetRange({ min: null, max: 12 })).toBe("-12");
    expect(formatTargetRange({ min: null, max: null })).toBe("");
  });

  it("read with an en dash on screen, and nothing when nothing is prescribed", () => {
    expect(formatTargetReadout({ min: 7, max: 8 })).toBe("7–8");
    expect(formatTargetReadout({ min: 8, max: 8 })).toBe("8");
    expect(formatTargetReadout({ min: 8, max: null })).toBe("8+");
    expect(formatTargetReadout({ min: null, max: 12 })).toBe("≤12");
    expect(formatTargetReadout({ min: null, max: null })).toBeNull();
  });

  it("round-trip: what the box shows parses back to the same pair", () => {
    for (const pair of [{ min: 7, max: 8 }, { min: 9, max: 9 }, { min: 6.5, max: 8 }]) {
      expect(parseTargetRange(formatTargetRange(pair), RPE)).toEqual(pair);
    }
  });
});

describe("clampTarget", () => {
  it("clamps and rounds", () => {
    expect(clampTarget(-3, REPS)).toBe(0);
    expect(clampTarget(4.4, REPS)).toBe(4);
    expect(clampTarget(11, RPE)).toBe(10);
  });
});
