import { describe, it, expect } from "vitest";
import {
  resolveEffectiveGoal,
  type ResolveEffectiveGoalInput,
} from "./resolve-effective-goal";
import { weightToKg } from "@/utils/nutrition-helpers";

const TODAY = "2026-06-05";

function input(overrides: Partial<ResolveEffectiveGoalInput> = {}): ResolveEffectiveGoalInput {
  return {
    weightUnit: "kg",
    clientGoal: null,
    today: TODAY,
    ...overrides,
  };
}

describe("resolveEffectiveGoal", () => {
  it("the live client goal drives", () => {
    const result = resolveEffectiveGoal(
      input({
        weightUnit: "kg",
        clientGoal: { goalWeight: 72, goalBodyFatPercentage: 15, deadline: "2026-12-01", startDate: "2026-02-01" },
      })
    );
    expect(result).toEqual({
      goalWeightKg: 72,
      goalBodyFatPercentage: 15,
      deadline: "2026-12-01",
      startDate: "2026-02-01",
    });
  });

  it("normalizes a lbs client goal weight to kg", () => {
    const result = resolveEffectiveGoal(
      input({
        weightUnit: "lbs",
        clientGoal: { goalWeight: 165, goalBodyFatPercentage: null, deadline: null, startDate: null },
      })
    );
    expect(result.goalWeightKg).toBeCloseTo(weightToKg(165, "lbs"), 5); // ~74.83 kg
    expect(result.startDate).toBe(TODAY); // no goal_start_date → today
  });

  it("passes a kg client goal weight through unchanged", () => {
    const result = resolveEffectiveGoal(
      input({ weightUnit: "kg", clientGoal: { goalWeight: 75, goalBodyFatPercentage: null, deadline: null, startDate: null } })
    );
    expect(result.goalWeightKg).toBe(75);
  });

  it("zero active goal (no client weight) → maintenance via null", () => {
    const noGoal = resolveEffectiveGoal(input({ clientGoal: null }));
    expect(noGoal).toEqual({
      goalWeightKg: null,
      goalBodyFatPercentage: null,
      deadline: null,
      startDate: TODAY,
    });

    const nullWeightGoal = resolveEffectiveGoal(
      input({ clientGoal: { goalWeight: null, goalBodyFatPercentage: null, deadline: null, startDate: null } })
    );
    expect(nullWeightGoal.goalWeightKg).toBeNull();
  });
});
