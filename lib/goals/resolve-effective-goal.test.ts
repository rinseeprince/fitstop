import { describe, it, expect } from "vitest";
import {
  resolveEffectiveGoal,
  type ResolveEffectiveGoalInput,
} from "./resolve-effective-goal";

const TODAY = "2026-06-05";

function input(overrides: Partial<ResolveEffectiveGoalInput> = {}): ResolveEffectiveGoalInput {
  return {
    clientGoal: null,
    today: TODAY,
    ...overrides,
  };
}

describe("resolveEffectiveGoal", () => {
  it("the live client goal drives", () => {
    const result = resolveEffectiveGoal(
      input({
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

  // Replaces the old "normalizes a lbs client goal weight to kg" case. Since
  // migration 141 the stored goal IS kilograms, so the resolver must pass it
  // through untouched — converting here would double-convert. Deliberately
  // asserts on 165, the value the deleted test fed in as pounds: if a
  // conversion ever creeps back, this lands on ~74.83 and fails.
  it("passes the stored goal weight through as kilograms, never converting", () => {
    const result = resolveEffectiveGoal(
      input({
        clientGoal: { goalWeight: 165, goalBodyFatPercentage: null, deadline: null, startDate: null },
      })
    );
    expect(result.goalWeightKg).toBe(165);
    expect(result.startDate).toBe(TODAY); // no goal_start_date → today
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
