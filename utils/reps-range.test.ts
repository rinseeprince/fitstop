import { describe, it, expect } from "vitest";
import { formatRepsRange, parseRepsRange, type RepsRange } from "./reps-range";

describe("formatRepsRange", () => {
  it("renders a true range with an ASCII hyphen", () => {
    expect(formatRepsRange({ min: 8, max: 12 })).toBe("8-12");
  });

  it("collapses an equal range to one number, matching setsRepsShort", () => {
    expect(formatRepsRange({ min: 12, max: 12 })).toBe("12");
  });

  it("renders an unset range as empty, never as a zero", () => {
    expect(formatRepsRange({ min: null, max: null })).toBe("");
  });

  it("keeps a half-open legacy range visible and editable", () => {
    expect(formatRepsRange({ min: 8, max: null })).toBe("8-");
    expect(formatRepsRange({ min: null, max: 12 })).toBe("-12");
  });
});

describe("parseRepsRange", () => {
  it("reads a range", () => {
    expect(parseRepsRange("8-12")).toEqual({ min: 8, max: 12 });
  });

  it("reads a single number as both bounds", () => {
    expect(parseRepsRange("12")).toEqual({ min: 12, max: 12 });
  });

  it("treats an empty field as a real cleared range, not a rejection", () => {
    expect(parseRepsRange("")).toEqual({ min: null, max: null });
    expect(parseRepsRange("   ")).toEqual({ min: null, max: null });
  });

  it("tolerates whitespace and pasted en/em dashes", () => {
    expect(parseRepsRange(" 8 - 12 ")).toEqual({ min: 8, max: 12 });
    expect(parseRepsRange("8–12")).toEqual({ min: 8, max: 12 });
    expect(parseRepsRange("8—12")).toEqual({ min: 8, max: 12 });
  });

  it("orders a reversed range rather than making the coach retype it", () => {
    expect(parseRepsRange("12-8")).toEqual({ min: 8, max: 12 });
  });

  it("reads half-open ranges", () => {
    expect(parseRepsRange("8-")).toEqual({ min: 8, max: null });
    expect(parseRepsRange("-12")).toEqual({ min: null, max: 12 });
  });

  it("clamps to the setSpecSchema bounds instead of emitting a value that 400s", () => {
    expect(parseRepsRange("999")).toEqual({ min: 100, max: 100 });
    expect(parseRepsRange("0-500")).toEqual({ min: 0, max: 100 });
  });

  it("rejects anything that is not a rep scheme so the caller can revert", () => {
    for (const bad of ["abc", "8-12-15", "8..12", "-", "8/12", "1e3", "8 12"]) {
      expect(parseRepsRange(bad)).toBeNull();
    }
  });

  it("round-trips every representable state", () => {
    const states: RepsRange[] = [
      { min: null, max: null },
      { min: 12, max: 12 },
      { min: 8, max: 12 },
      { min: 8, max: null },
      { min: null, max: 12 },
      { min: 0, max: 0 },
    ];
    for (const state of states) {
      expect(parseRepsRange(formatRepsRange(state))).toEqual(state);
    }
  });
});
