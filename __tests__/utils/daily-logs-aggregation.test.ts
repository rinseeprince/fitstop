import { describe, it, expect } from 'vitest';
import { sanitiseReps } from "@/utils/daily-logs-aggregation";

describe("sanitiseReps", () => {
  it("returns undefined for 0", () => {
    expect(sanitiseReps(0)).toBeUndefined();
  });

  it("returns undefined for negative numbers", () => {
    expect(sanitiseReps(-1)).toBeUndefined();
    expect(sanitiseReps(-100)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(sanitiseReps(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(sanitiseReps(undefined)).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(sanitiseReps(NaN)).toBeUndefined();
  });

  it("returns undefined for non-numeric strings", () => {
    expect(sanitiseReps("abc")).toBeUndefined();
    expect(sanitiseReps("")).toBeUndefined();
  });

  it("returns the number for valid positive integers", () => {
    expect(sanitiseReps(1)).toBe(1);
    expect(sanitiseReps(10)).toBe(10);
    expect(sanitiseReps(100)).toBe(100);
  });

  it("parses valid numeric strings", () => {
    expect(sanitiseReps("5")).toBe(5);
    expect(sanitiseReps("15")).toBe(15);
    expect(sanitiseReps("100")).toBe(100);
  });

  it("returns undefined for zero as string", () => {
    expect(sanitiseReps("0")).toBeUndefined();
  });

  it("returns undefined for negative numbers as strings", () => {
    expect(sanitiseReps("-5")).toBeUndefined();
  });

  it("handles decimal numbers by parsing as integers", () => {
    expect(sanitiseReps(5.7)).toBe(5);
    expect(sanitiseReps("5.7")).toBe(5);
  });
});