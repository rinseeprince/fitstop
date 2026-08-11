import { describe, expect, it } from "vitest";
import { JOURNEY_SUBTABS, isJourneySubtab } from "./metrics-view-types";

describe("isJourneySubtab", () => {
  it("accepts every member of JOURNEY_SUBTABS", () => {
    for (const value of JOURNEY_SUBTABS) {
      expect(isJourneySubtab(value)).toBe(true);
    }
  });

  it("rejects unknown values, null, and the empty string", () => {
    // The old two-way ternary silently resolved every unknown value to "body";
    // the guard makes the fallback an explicit caller decision instead.
    expect(isJourneySubtab("exercise-data")).toBe(false);
    expect(isJourneySubtab("plans")).toBe(false);
    expect(isJourneySubtab("")).toBe(false);
    expect(isJourneySubtab(null)).toBe(false);
  });
});
