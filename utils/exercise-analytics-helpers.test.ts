import { describe, it, expect } from "vitest";
import { calculateEpleyE1RM } from "./exercise-analytics-helpers";

describe("calculateEpleyE1RM", () => {
  it("calculates correctly for normal inputs", () => {
    // 100 * (1 + 10/30) = 100 * 1.333... ≈ 133.33
    expect(calculateEpleyE1RM(100, 10)).toBeCloseTo(133.33, 1);
  });

  it("returns weight directly for 1-rep set", () => {
    expect(calculateEpleyE1RM(150, 1)).toBe(150);
  });

  it("returns null for zero weight", () => {
    expect(calculateEpleyE1RM(0, 5)).toBeNull();
  });

  it("returns null for negative weight", () => {
    expect(calculateEpleyE1RM(-50, 5)).toBeNull();
  });

  it("returns null for zero reps", () => {
    expect(calculateEpleyE1RM(100, 0)).toBeNull();
  });

  it("returns null for reps > 30", () => {
    expect(calculateEpleyE1RM(100, 31)).toBeNull();
  });

  it("handles boundary reps = 30", () => {
    // 100 * (1 + 30/30) = 200
    expect(calculateEpleyE1RM(100, 30)).toBe(200);
  });
});
