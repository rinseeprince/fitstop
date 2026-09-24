import { describe, it, expect } from "vitest";
import { deriveGoalProgress } from "./goal-progress";

// One client losing weight: 92 kg at their start, 90 on the day this goal
// began, 84 now, aiming for 78; body fat 24 → 23 → 19 → 16. Sixty-three days
// (nine weeks) to the deadline.
const goal = {
  goalWeightKg: 78,
  goalBodyFatPercentage: 16,
  deadline: "2026-11-30",
  type: "lose_weight" as const,
};
const client = {
  currentWeight: 84,
  currentBodyFatPercentage: 19,
  startingWeight: 92,
  startingBodyFatPercentage: 24,
  goalStartWeight: 90,
  goalStartBodyFatPercentage: 23,
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
      goalStartWeight: 90,
      position: {
        current: 84,
        remaining: -6,
        // 6 of the 12 kg from the goal's start (90), not 8 of 14 from the baseline.
        percentComplete: 50,
        status: "approaching",
        trend: "towards",
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
      goalStartBodyFat: 23,
      position: {
        current: 19,
        remaining: -3,
        // 4 of the 7 points from the goal's start (23).
        percentComplete: 57.1,
        status: "approaching",
        trend: "towards",
      },
    });
  });

  it("keeps the row and nulls the position when the record has no reading", () => {
    // The goal is real; the verdict is not. A missing row would read as "no
    // goal" on the strip, which is the bug this kernel exists to end.
    const progress = deriveGoalProgress({
      effectiveGoal: goal,
      client: {
        startingWeight: 92,
        startingBodyFatPercentage: 24,
        goalStartWeight: 90,
        goalStartBodyFatPercentage: 23,
      },
      trend: {},
      ...nineWeeks,
    });

    expect(progress.weight).toEqual({ goal: 78, startingWeight: 92, goalStartWeight: 90, position: null });
    expect(progress.bodyFat).toEqual({ goal: 16, startingBodyFat: 24, goalStartBodyFat: 23, position: null });
    // The deadline belongs to the goal, not to the reading.
    expect(progress.deadline).toEqual({ date: "2026-11-30", daysRemaining: 63, isPastDeadline: false });
  });

  it("has no row for a goal that is not set", () => {
    const progress = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: null, goalBodyFatPercentage: null, deadline: null, type: null },
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

    expect(weight?.position?.trend).toBe("away");
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

// The direction a goal is judged in is its TYPE's where the type sets one
// (`goalDirection`, lib/goals/goal-types.ts), else the side of the goal's
// start the target sits on.
describe("deriveGoalProgress — the goal type's direction", () => {
  it("judges a lose-weight goal downward even with no start reading", () => {
    // Below the target with nothing to measure from: the type still says which
    // way the client was asked to move, so they are past it.
    const { weight } = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: 71, goalBodyFatPercentage: null, deadline: null, type: "lose_weight" },
      client: { currentWeight: 69.5 },
      trend: {},
      ...noDeadline,
    });

    expect(weight?.goalStartWeight).toBeUndefined();
    expect(weight?.position?.status).toBe("overshot");
  });

  it("judges a build-muscle goal upward, whatever side of the start the target sits on", () => {
    // Started at 95, aiming for 88 — the side of the start says down, the type
    // says up: at 91 the client is past a target they were asked to climb to.
    const { weight } = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: 88, goalBodyFatPercentage: null, deadline: null, type: "build_muscle" },
      client: { currentWeight: 91, goalStartWeight: 95 },
      trend: {},
      ...noDeadline,
    });

    expect(weight?.position?.status).toBe("overshot");
  });

  it("judges a recomp's body fat downward", () => {
    // Started at 13, aiming for 14.5 — by the side of the start that is a
    // climb, but a recomp counts body fat down: at 14 the target is passed.
    const { bodyFat } = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: null, goalBodyFatPercentage: 14.5, deadline: null, type: "recomposition" },
      client: { currentBodyFatPercentage: 14, goalStartBodyFatPercentage: 13 },
      trend: {},
      ...noDeadline,
    });

    expect(bodyFat?.position?.status).toBe("overshot");
  });

  it("falls back to the side of the start for a type that sets no direction", () => {
    const below = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: 80, goalBodyFatPercentage: null, deadline: null, type: "maintain" },
      client: { currentWeight: 79, goalStartWeight: 83 },
      trend: {},
      ...noDeadline,
    });
    const above = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: 80, goalBodyFatPercentage: null, deadline: null, type: "maintain" },
      client: { currentWeight: 79, goalStartWeight: 77 },
      trend: {},
      ...noDeadline,
    });

    // From 83 down to 80, 79 is past it; from 77 up to 80, 79 is still short.
    expect(below.weight?.position?.status).toBe("overshot");
    expect(above.weight?.position?.status).toBe("approaching");
    // …and with no start there is no side to take.
    const noStart = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: 80, goalBodyFatPercentage: null, deadline: null, type: "event_prep" },
      client: { currentWeight: 79 },
      trend: {},
      ...noDeadline,
    });
    expect(noStart.weight?.position?.status).toBe("approaching");
  });

  it("runs percentComplete from the goal's start reading, never the baseline", () => {
    // Baseline 103, goal start 98, now 95.5, aiming for 93: 2.5 of the 5 kg
    // since the goal began (50%), where the baseline would say 7.5 of 10 (75%).
    const { weight } = deriveGoalProgress({
      effectiveGoal: { goalWeightKg: 93, goalBodyFatPercentage: null, deadline: null, type: "lose_weight" },
      client: { currentWeight: 95.5, startingWeight: 103, goalStartWeight: 98 },
      trend: {},
      ...noDeadline,
    });

    expect(weight?.position?.percentComplete).toBe(50);
    // The row still carries the baseline, for the surfaces that count "since start".
    expect(weight?.startingWeight).toBe(103);
    expect(weight?.goalStartWeight).toBe(98);
  });
});
