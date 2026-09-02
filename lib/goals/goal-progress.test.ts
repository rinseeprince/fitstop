import { describe, it, expect } from "vitest";
import { deriveGoalProgress } from "./goal-progress";

// One client, read from the CLIENT RECORD: 92 kg at the start, 84 now, aiming
// for 78; body fat 24 → 19 → 16. Sixty-three days (nine weeks) to the deadline.
const goal = { goalWeightKg: 78, goalBodyFatPercentage: 16, deadline: "2026-11-30" };
const client = {
  currentWeight: 84,
  currentBodyFatPercentage: 19,
  startingWeight: 92,
  startingBodyFatPercentage: 24,
};
const trend = { avgWeeklyWeightChange: -0.4, avgBodyFatChange: -0.2 };
const nineWeeks = { daysRemaining: 63, weeksRemaining: 9 };
const noDeadline = { daysRemaining: null, weeksRemaining: null };

describe("deriveGoalProgress", () => {
  it("positions a set goal against the client's current reading", () => {
    const { weight } = deriveGoalProgress({ effectiveGoal: goal, client, trend, ...nineWeeks });

    expect(weight).toEqual({
      goal: 78,
      startingWeight: 92,
      position: {
        current: 84,
        remaining: -6,
        percentComplete: 57.1,
        status: "approaching",
        isOnTrack: true,
        // 6 kg over 9 weeks is 0.67 kg/week, under the 0.84 ceiling (1% of 84).
        paceStatus: "on_track",
      },
    });
  });

  it("positions body fat the same way, without a pace", () => {
    const { bodyFat } = deriveGoalProgress({ effectiveGoal: goal, client, trend, ...nineWeeks });

    expect(bodyFat).toEqual({
      goal: 16,
      startingBodyFat: 24,
      position: {
        current: 19,
        remaining: -3,
        percentComplete: 62.5,
        status: "approaching",
        isOnTrack: true,
      },
    });
  });

  it("keeps the row and nulls the position when the record has no reading", () => {
    // The goal is real; the verdict is not. A missing row would read as "no
    // goal" on the strip, which is the bug this kernel exists to end.
    const progress = deriveGoalProgress({
      effectiveGoal: goal,
      client: { startingWeight: 92, startingBodyFatPercentage: 24 },
      trend: {},
      ...nineWeeks,
    });

    expect(progress.weight).toEqual({ goal: 78, startingWeight: 92, position: null });
    expect(progress.bodyFat).toEqual({ goal: 16, startingBodyFat: 24, position: null });
    // The deadline belongs to the goal, not to the reading.
    expect(progress.deadline).toEqual({ date: "2026-11-30", daysRemaining: 63, isPastDeadline: false });
  });

  it("has no row for a goal that is not set", () => {
    const progress = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: null, goalBodyFatPercentage: null, deadline: null },
      client,
      trend,
      ...noDeadline,
    });

    expect(progress).toEqual({});
  });

  it("builds only the rows whose goals are set", () => {
    const progress = deriveGoalProgress({
      effectiveGoal: { ...goal, goalBodyFatPercentage: null },
      client,
      trend,
      ...nineWeeks,
    });

    expect(progress.weight).toBeDefined();
    expect(progress.bodyFat).toBeUndefined();
  });

  it("reads off track when the recent trend points away from the goal", () => {
    const { weight } = deriveGoalProgress({
      effectiveGoal: goal,
      client,
      trend: { avgWeeklyWeightChange: 0.3 },
      ...nineWeeks,
    });

    expect(weight?.position?.isOnTrack).toBe(false);
    // Pace is the rate REQUIRED, not the client's own, so it is still safe.
    expect(weight?.position?.paceStatus).toBe("on_track");
  });

  it("carries no pace and no deadline row without a deadline", () => {
    const progress = deriveGoalProgress({
      effectiveGoal: { ...goal, deadline: null },
      client,
      trend,
      ...noDeadline,
    });

    expect(progress.weight?.position?.paceStatus).toBeUndefined();
    expect(progress.deadline).toBeUndefined();
  });

  it("reports a passed goal as overshot, with no pace to assess", () => {
    const { weight } = deriveGoalProgress({
      effectiveGoal: goal,
      client: { ...client, currentWeight: 76 },
      trend,
      ...nineWeeks,
    });

    expect(weight?.position?.status).toBe("overshot");
    expect(weight?.position?.remaining).toBe(2);
    expect(weight?.position?.paceStatus).toBeUndefined();
  });

  it("marks a deadline that has gone, and the pace it makes unrealistic", () => {
    const progress = deriveGoalProgress({
      effectiveGoal: goal,
      client,
      trend,
      daysRemaining: -5,
      weeksRemaining: -5 / 7,
    });

    expect(progress.deadline).toEqual({ date: "2026-11-30", daysRemaining: -5, isPastDeadline: true });
    expect(progress.weight?.position?.paceStatus).toBe("unrealistic");
  });

  it("rounds the goal weight to one decimal, once, and positions against it", () => {
    const { weight } = deriveGoalProgress({
      effectiveGoal: { ...goal, goalWeightKg: 81.44 },
      client,
      trend,
      ...noDeadline,
    });

    expect(weight?.goal).toBe(81.4);
    expect(weight?.position?.remaining).toBeCloseTo(-2.6, 5);
  });
});
