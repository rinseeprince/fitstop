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
      phaseRateKgPerWeek: null,
      phaseName: null,
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
      phaseRateKgPerWeek: null,
      phaseName: null,
    });

    const nullWeightGoal = resolveEffectiveGoal(
      input({ clientGoal: { goalWeight: null, goalBodyFatPercentage: null, deadline: null, startDate: null } })
    );
    expect(nullWeightGoal.goalWeightKg).toBeNull();
  });
});

describe("resolveEffectiveGoal — blocks", () => {
  // Chained from 2026-06-01: Cut 1 covers TODAY (06-05), Diet break follows.
  const PHASES = [
    { name: "Cut 1", startsOn: "2026-06-01", endsOn: "2026-06-28", ratePerWeekKg: -0.6 },
    { name: "Diet break", startsOn: "2026-06-29", endsOn: "2026-07-12", ratePerWeekKg: 0 },
  ];

  const GOAL = {
    goalWeight: 72,
    goalBodyFatPercentage: 15,
    deadline: "2026-12-01",
    startDate: "2026-02-01",
  };

  it("the block covering `date` supplies the rate and the name", () => {
    const result = resolveEffectiveGoal(
      input({ clientGoal: GOAL, phases: PHASES, date: "2026-06-10" })
    );
    expect(result.phaseRateKgPerWeek).toBe(-0.6);
    expect(result.phaseName).toBe("Cut 1");
  });

  it("`date` defaults to `today` when the caller does not pass one", () => {
    const result = resolveEffectiveGoal(input({ clientGoal: GOAL, phases: PHASES }));
    expect(result.phaseName).toBe("Cut 1"); // TODAY = 2026-06-05
  });

  it("an explicit `date` selects a different block than `today` would", () => {
    // The whole point of the parameter: the check-in comparison anchors on the
    // period's end, which is routinely in a different block than today.
    const result = resolveEffectiveGoal(
      input({ clientGoal: GOAL, phases: PHASES, date: "2026-07-01" })
    );
    expect(result.phaseName).toBe("Diet break");
  });

  it("a date outside every block resolves to no rate", () => {
    const before = resolveEffectiveGoal(
      input({ clientGoal: GOAL, phases: PHASES, date: "2026-05-31" })
    );
    const after = resolveEffectiveGoal(
      input({ clientGoal: GOAL, phases: PHASES, date: "2026-07-13" })
    );
    for (const result of [before, after]) {
      expect(result.phaseRateKgPerWeek).toBeNull();
      expect(result.phaseName).toBeNull();
    }
  });

  it("a rate of 0 resolves to 0, not null — a `0` block IS maintenance", () => {
    // Invariant 5. `0` is falsy, so a truthiness check here would silently
    // report "no block covers this date" for every maintenance block.
    const result = resolveEffectiveGoal(
      input({ clientGoal: GOAL, phases: PHASES, date: "2026-07-01" })
    );
    expect(result.phaseRateKgPerWeek).toBe(0);
    expect(result.phaseRateKgPerWeek).not.toBeNull();
  });

  it("an empty block list is identical to passing none", () => {
    const withEmpty = resolveEffectiveGoal(input({ clientGoal: GOAL, phases: [] }));
    const withNone = resolveEffectiveGoal(input({ clientGoal: GOAL }));
    expect(withEmpty).toEqual(withNone);
    expect(withEmpty.phaseRateKgPerWeek).toBeNull();
  });

  it("blocks never move the destination — only the rate (invariant 4)", () => {
    const withPhases = resolveEffectiveGoal(
      input({ clientGoal: GOAL, phases: PHASES, date: "2026-06-10" })
    );
    const withoutPhases = resolveEffectiveGoal(input({ clientGoal: GOAL }));

    expect(withPhases.goalWeightKg).toBe(withoutPhases.goalWeightKg);
    expect(withPhases.goalBodyFatPercentage).toBe(withoutPhases.goalBodyFatPercentage);
    expect(withPhases.deadline).toBe(withoutPhases.deadline);
    expect(withPhases.startDate).toBe(withoutPhases.startDate);
  });
});
