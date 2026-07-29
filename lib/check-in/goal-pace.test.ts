import { describe, it, expect } from "vitest";
import { computeGoalPace } from "./goal-pace";

describe("computeGoalPace", () => {
  it("returns null without a valid current weight", () => {
    expect(computeGoalPace({ remainingKg: 2, weeksRemaining: 4, currentWeightKg: 0 })).toBeNull();
    expect(computeGoalPace({ remainingKg: 2, weeksRemaining: 4 })).toBeNull();
  });

  it("is on track when the required rate is within the safe ceiling", () => {
    // 96kg -> ceiling 0.96 kg/wk; need 3.2kg over 4 weeks = 0.8 kg/wk
    const pace = computeGoalPace({ remainingKg: 3.2, weeksRemaining: 4, currentWeightKg: 96 });
    expect(pace?.safeCeiling).toBe(0.96);
    expect(pace?.requiredRate).toBe(0.8);
    expect(pace?.status).toBe("on_track");
  });

  it("is behind pace between 1x and 1.5x the ceiling", () => {
    // ceiling 0.96; need 1.2 kg/wk -> ratio 1.25
    const pace = computeGoalPace({ remainingKg: 1.2, weeksRemaining: 1, currentWeightKg: 96 });
    expect(pace?.status).toBe("behind_pace");
  });

  it("is unrealistic above 1.5x the ceiling (test data: 3.9kg over 12 days)", () => {
    const pace = computeGoalPace({ remainingKg: 3.9, weeksRemaining: 12 / 7, currentWeightKg: 96 });
    expect(pace?.requiredRate).toBeCloseTo(2.28, 1);
    expect(pace?.status).toBe("unrealistic");
  });

  it("treats a reached goal as on track", () => {
    expect(computeGoalPace({ remainingKg: 0, weeksRemaining: 4, currentWeightKg: 96 })?.status).toBe(
      "on_track"
    );
  });

  it("is unrealistic when the deadline has already passed", () => {
    expect(computeGoalPace({ remainingKg: 2, weeksRemaining: 0, currentWeightKg: 96 })?.status).toBe(
      "unrealistic"
    );
  });
});
