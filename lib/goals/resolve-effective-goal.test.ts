import { describe, it, expect } from "vitest";
import { resolveEffectiveGoal } from "./resolve-effective-goal";

/** The parts of the goal in force on a day that the resolver reads. */
type GoalTargetsOnDay = NonNullable<Parameters<typeof resolveEffectiveGoal>[0]>;

function goal(overrides: Partial<GoalTargetsOnDay> = {}): GoalTargetsOnDay {
  return {
    targetWeight: null,
    targetBodyFatPercentage: null,
    deadline: null,
    ...overrides,
  };
}

describe("resolveEffectiveGoal", () => {
  it("the goal in force drives — weight, body fat and deadline, and nothing else", () => {
    const result = resolveEffectiveGoal(
      goal({ targetWeight: 72, targetBodyFatPercentage: 15, deadline: "2026-12-01" })
    );
    // Exactly three keys. A goal has no start of its own for the calculator:
    // the window a nutrition deficit is spread over begins at the day the plan
    // takes effect (docs/MEASUREMENT-LOG-PLAN.md commit 8bb), handed to the
    // calculator by the orchestrator and the drawer — a `startDate` here would
    // be a second lever on that window.
    expect(result).toEqual({
      goalWeightKg: 72,
      goalBodyFatPercentage: 15,
      deadline: "2026-12-01",
    });
  });

  // The stored target IS kilograms (CONVENTIONS §20), so the resolver passes it
  // through untouched: a conversion creeping back in would land 165 on ~74.83.
  it("passes the stored weight target through as kilograms, never converting", () => {
    expect(resolveEffectiveGoal(goal({ targetWeight: 165 })).goalWeightKg).toBe(165);
  });

  it("no goal in force → maintenance via null", () => {
    expect(resolveEffectiveGoal(null)).toEqual({
      goalWeightKg: null,
      goalBodyFatPercentage: null,
      deadline: null,
    });
  });

  it("a goal with no weight target is maintenance for the calculator, and keeps its other parts", () => {
    const result = resolveEffectiveGoal(
      goal({ targetBodyFatPercentage: 18, deadline: "2027-02-26" })
    );

    expect(result).toEqual({
      goalWeightKg: null,
      goalBodyFatPercentage: 18,
      deadline: "2027-02-26",
    });
  });

  it("a goal with no deadline carries none", () => {
    expect(resolveEffectiveGoal(goal({ targetWeight: 81 })).deadline).toBeNull();
  });
});
