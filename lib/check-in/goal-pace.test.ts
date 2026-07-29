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

describe("computeGoalPace — a covering block prescribes the rate", () => {
  it("the block's rate replaces the deadline-derived average", () => {
    // Deadline math alone would need 3.9/(12/7) = 2.28 kg/wk -> unrealistic.
    // The coach's block prescribes 0.6 kg/wk, which is inside the 0.96 ceiling.
    const withoutBlock = computeGoalPace({
      remainingKg: 3.9,
      weeksRemaining: 12 / 7,
      currentWeightKg: 96,
    });
    const withBlock = computeGoalPace({
      remainingKg: 3.9,
      weeksRemaining: 12 / 7,
      currentWeightKg: 96,
      prescribedRatePerWeek: -0.6,
    });

    expect(withoutBlock?.status).toBe("unrealistic");
    expect(withBlock?.requiredRate).toBe(0.6);
    expect(withBlock?.status).toBe("on_track");
  });

  it("only the magnitude matters — a gain block grades like its mirror", () => {
    const gain = computeGoalPace({
      remainingKg: 2,
      weeksRemaining: 4,
      currentWeightKg: 96,
      prescribedRatePerWeek: 0.5,
    });
    const loss = computeGoalPace({
      remainingKg: 2,
      weeksRemaining: 4,
      currentWeightKg: 96,
      prescribedRatePerWeek: -0.5,
    });
    expect(gain?.requiredRate).toBe(0.5);
    expect(gain).toEqual(loss);
  });

  it("a rate of 0 is a maintenance block, not 'no block' — always on track", () => {
    // Invariant 5. A truthiness check here would fall back to the deadline
    // average and report a maintenance block as behind pace.
    const pace = computeGoalPace({
      remainingKg: 5,
      weeksRemaining: 1,
      currentWeightKg: 96,
      prescribedRatePerWeek: 0,
    });
    expect(pace?.requiredRate).toBe(0);
    expect(pace?.status).toBe("on_track");
  });

  it("null or omitted keeps the deadline-derived behaviour exactly", () => {
    const baseline = computeGoalPace({
      remainingKg: 3.2,
      weeksRemaining: 4,
      currentWeightKg: 96,
    });
    const explicitNull = computeGoalPace({
      remainingKg: 3.2,
      weeksRemaining: 4,
      currentWeightKg: 96,
      prescribedRatePerWeek: null,
    });
    expect(explicitNull).toEqual(baseline);
    expect(explicitNull?.requiredRate).toBe(0.8);
  });

  it("a passed deadline still wins over a prescribed rate", () => {
    // The block says how fast this leg runs; it does not un-blow a deadline.
    const pace = computeGoalPace({
      remainingKg: 2,
      weeksRemaining: 0,
      currentWeightKg: 96,
      prescribedRatePerWeek: -0.5,
    });
    expect(pace?.status).toBe("unrealistic");
  });
});
