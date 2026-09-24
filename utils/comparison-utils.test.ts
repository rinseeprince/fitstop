import { describe, it, expect } from "vitest";
import { calculateGoalProgress, deriveGoalStatus } from "./comparison-utils";

/**
 * This file did not exist. `calculateGoalProgress` was untested, which is how a
 * goal overshot by 5 kg came to render "100% Complete", "On track" and
 * "Remaining 5kg" at the same time, above a projected completion date three
 * weeks past its own deadline.
 */
describe("deriveGoalStatus", () => {
  // The live case: a weight-LOSS goal, passed. start 88 -> goal 77, now 72.
  it("calls a passed loss goal overshot, not approaching", () => {
    expect(deriveGoalStatus(72, 77, 88)).toBe("overshot");
  });

  it("calls a loss goal still above target approaching", () => {
    expect(deriveGoalStatus(82, 77, 88)).toBe("approaching");
  });

  it("mirrors for a GAIN goal", () => {
    expect(deriveGoalStatus(80, 77, 70)).toBe("overshot");
    expect(deriveGoalStatus(74, 77, 70)).toBe("approaching");
  });

  it("calls a goal within a hair of its target achieved, in either direction", () => {
    expect(deriveGoalStatus(77, 77, 88)).toBe("achieved");
    expect(deriveGoalStatus(77.02, 77, 88)).toBe("achieved");
    expect(deriveGoalStatus(76.98, 77, 88)).toBe("achieved");
  });

  it("cannot claim an overshoot without a start — there is no direction to pass in", () => {
    // With no starting value the client may have been asked to gain OR lose.
    expect(deriveGoalStatus(72, 77, undefined)).toBe("approaching");
    // Same when the start already sat on the goal.
    expect(deriveGoalStatus(72, 77, 77)).toBe("approaching");
  });

  it("handles a body-fat goal, which counts down like a loss goal", () => {
    expect(deriveGoalStatus(12, 15, 20)).toBe("overshot");
    expect(deriveGoalStatus(17, 15, 20)).toBe("approaching");
  });
});

describe("calculateGoalProgress", () => {
  it("reports the live overshoot without hiding it behind a clamp", () => {
    const p = calculateGoalProgress(72, 77, 88, -0.4);

    expect(p.status).toBe("overshot");
    // 100% is TRUE once the goal is met — the bar cannot exceed its own track,
    // and it was never the wrong number. The lie was the figures beside it.
    expect(p.percentComplete).toBe(100);
    // Signed, so a caller can tell which side of the goal they are on. A
    // renderer showing a magnitude checks `status` first.
    expect(p.remaining).toBe(5);
    // Already correct before this change, and the reason the two goal cards
    // disagreed: the weight card let paceStatus mask it.
    expect(p.trend).toBe("away");
  });

  it("keeps remaining signed the other way while the goal is being approached", () => {
    const p = calculateGoalProgress(82, 77, 88, -0.4);

    expect(p.status).toBe("approaching");
    expect(p.remaining).toBe(-5);
    // Losing weight towards a lower goal.
    expect(p.trend).toBe("towards");
    expect(p.percentComplete).toBe(54.5);
  });

  it("reads the trend against the target, either way (commit 8d4)", () => {
    // 84.3 now, aiming for 79.1: gaining is away, losing is towards.
    expect(calculateGoalProgress(84.3, 79.1, 87.6, 0.35).trend).toBe("away");
    expect(calculateGoalProgress(84.3, 79.1, 87.6, -0.55).trend).toBe("towards");
    // A gain goal mirrors it: 66.2 aiming for 70.8.
    expect(calculateGoalProgress(66.2, 70.8, 63.9, 0.45).trend).toBe("towards");
    expect(calculateGoalProgress(66.2, 70.8, 63.9, -0.25).trend).toBe("away");
  });

  it("has no trend without an average — fewer than two readings — never a guess", () => {
    expect(calculateGoalProgress(83.1, 78.7, 88.9).trend).toBeNull();
  });

  it("reads a client who has not moved at all as unchanged", () => {
    expect(calculateGoalProgress(81.7, 76.4, 85.2, 0).trend).toBe("unchanged");
  });

  it("never returns a percentage outside 0-100", () => {
    expect(calculateGoalProgress(60, 77, 88).percentComplete).toBe(100);
    // Moved the wrong way past the start: negative progress, clamped at 0.
    expect(calculateGoalProgress(92, 77, 88).percentComplete).toBe(0);
  });
});
