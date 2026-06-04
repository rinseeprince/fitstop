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
    activePhase: null,
    clientGoal: null,
    today: TODAY,
    ...overrides,
  };
}

describe("resolveEffectiveGoal", () => {
  it("active phase with a weight drives (source=phase, phase dates)", () => {
    const result = resolveEffectiveGoal(
      input({
        activePhase: {
          goalWeightKg: 80,
          goalBodyFatPercentage: 12,
          startDate: "2026-05-01",
          endDate: "2026-08-01",
        },
        // A live client goal is present but MUST be ignored while a phase is active.
        clientGoal: { goalWeight: 70, goalBodyFatPercentage: 18, deadline: "2026-12-01", startDate: "2026-01-01" },
      })
    );
    expect(result).toEqual({
      goalWeightKg: 80,
      goalBodyFatPercentage: 12,
      deadline: "2026-08-01",
      startDate: "2026-05-01",
      source: "phase",
    });
  });

  it("active phase with a NULL weight is maintenance — no fallback to the client goal", () => {
    const result = resolveEffectiveGoal(
      input({
        activePhase: {
          goalWeightKg: null,
          goalBodyFatPercentage: null,
          startDate: "2026-05-01",
          endDate: "2026-08-01",
        },
        clientGoal: { goalWeight: 70, goalBodyFatPercentage: 18, deadline: "2026-12-01", startDate: "2026-01-01" },
      })
    );
    expect(result.source).toBe("phase");
    expect(result.goalWeightKg).toBeNull(); // maintenance, NOT 70
    expect(result.goalBodyFatPercentage).toBeNull();
    expect(result.deadline).toBe("2026-08-01");
  });

  it("active phase falls back to today when it has no start date", () => {
    const result = resolveEffectiveGoal(
      input({
        activePhase: { goalWeightKg: 80, goalBodyFatPercentage: null, startDate: null, endDate: null },
      })
    );
    expect(result.startDate).toBe(TODAY);
    expect(result.deadline).toBeNull();
  });

  it("no active phase → the live client goal drives (source=client)", () => {
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
      source: "client",
    });
  });

  it("normalizes a lbs client goal weight to kg", () => {
    const result = resolveEffectiveGoal(
      input({
        weightUnit: "lbs",
        clientGoal: { goalWeight: 165, goalBodyFatPercentage: null, deadline: null, startDate: null },
      })
    );
    expect(result.source).toBe("client");
    expect(result.goalWeightKg).toBeCloseTo(weightToKg(165, "lbs"), 5); // ~74.83 kg
    expect(result.startDate).toBe(TODAY); // no goal_start_date → today
  });

  it("passes a kg client goal weight through unchanged", () => {
    const result = resolveEffectiveGoal(
      input({ weightUnit: "kg", clientGoal: { goalWeight: 75, goalBodyFatPercentage: null, deadline: null, startDate: null } })
    );
    expect(result.goalWeightKg).toBe(75);
  });

  it("zero active goal (no phase, no client weight) → maintenance via null", () => {
    const noGoal = resolveEffectiveGoal(input({ clientGoal: null }));
    expect(noGoal).toEqual({
      goalWeightKg: null,
      goalBodyFatPercentage: null,
      deadline: null,
      startDate: TODAY,
      source: "client",
    });

    const nullWeightGoal = resolveEffectiveGoal(
      input({ clientGoal: { goalWeight: null, goalBodyFatPercentage: null, deadline: null, startDate: null } })
    );
    expect(nullWeightGoal.goalWeightKg).toBeNull();
    expect(nullWeightGoal.source).toBe("client");
  });
});
