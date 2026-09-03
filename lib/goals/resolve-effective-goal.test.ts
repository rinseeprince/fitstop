import { describe, it, expect } from "vitest";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
  type ResolveEffectiveGoalInput,
} from "./resolve-effective-goal";

function input(overrides: Partial<ResolveEffectiveGoalInput> = {}): ResolveEffectiveGoalInput {
  return {
    clientGoal: null,
    ...overrides,
  };
}

describe("resolveEffectiveGoal", () => {
  it("the live client goal drives — weight, body fat and deadline, and nothing else", () => {
    const result = resolveEffectiveGoal(
      input({
        clientGoal: { goalWeight: 72, goalBodyFatPercentage: 15, deadline: "2026-12-01" },
      })
    );
    // Exactly three keys. A goal has no start of its own: the window a
    // nutrition deficit is spread over begins at the day the plan takes effect
    // (docs/MEASUREMENT-LOG-PLAN.md commit 8bb), handed to the calculator by
    // the orchestrator and the drawer — a `startDate` here would be a second
    // lever on that window, and the resolver takes no `today` to fall back to.
    expect(result).toEqual({
      goalWeightKg: 72,
      goalBodyFatPercentage: 15,
      deadline: "2026-12-01",
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
        clientGoal: { goalWeight: 165, goalBodyFatPercentage: null, deadline: null },
      })
    );
    expect(result.goalWeightKg).toBe(165);
  });

  it("zero active goal (no client weight) → maintenance via null", () => {
    const noGoal = resolveEffectiveGoal(input({ clientGoal: null }));
    expect(noGoal).toEqual({
      goalWeightKg: null,
      goalBodyFatPercentage: null,
      deadline: null,
    });

    const nullWeightGoal = resolveEffectiveGoal(
      input({ clientGoal: { goalWeight: null, goalBodyFatPercentage: null, deadline: null } })
    );
    expect(nullWeightGoal.goalWeightKg).toBeNull();
  });
});

describe("toClientGoalInput", () => {
  const GOAL = {
    goalWeight: 82,
    goalBodyFatPercentage: 18,
    goalDeadline: "2026-12-01",
  };
  const MIRROR = { goalWeight: 99, goalBodyFatPercentage: 30 };

  it("the live client_goals record wins over the mirror on both targets", () => {
    expect(toClientGoalInput(GOAL, MIRROR)).toEqual({
      goalWeight: 82,
      goalBodyFatPercentage: 18,
      deadline: "2026-12-01",
    });
  });

  it("falls back to the mirror for a client with no client_goals row", () => {
    // The documented read switch: a goal set before client_goals existed lives
    // only in the denormalized columns, and both are canonical kg (mig 141).
    expect(toClientGoalInput(null, MIRROR)).toEqual({
      goalWeight: 99,
      goalBodyFatPercentage: 30,
      deadline: null,
    });
  });

  // The deletion this pins is a decision, not an accident (owner, 2026-08-12).
  // `mapClientRow` never mapped `clients.goal_deadline`, so `Client.goalDeadline`
  // was permanently undefined and the `?? client.goalDeadline` leg was
  // unreachable at all three call sites. Re-adding a mirror leg here would make a
  // deadline that can silently diverge reachable in the calculator and the pace
  // check for the first time — so the deadline resolves from client_goals ONLY,
  // even when a caller hands in an object that happens to carry one.
  it("never reads a deadline off the mirror, even one smuggled in by a caller", () => {
    const smuggled = { ...MIRROR, goalDeadline: "2030-01-01" } as {
      goalWeight: number;
      goalBodyFatPercentage: number;
    };

    expect(toClientGoalInput(null, smuggled).deadline).toBeNull();
    expect(toClientGoalInput({ goalWeight: 82 }, smuggled).deadline).toBeNull();
  });

  it("a maintenance goal (row present, weight null) still falls through to the mirror", () => {
    // Documented consequence of the `??` chain shared by every caller: a NULL
    // goal_weight in client_goals is indistinguishable from "no row" here. It is
    // safe only because updateGoals dual-writes the same merged value, so the two
    // stores agree — and it is one of the things full mirror removal fixes.
    expect(toClientGoalInput({ goalWeight: null }, MIRROR).goalWeight).toBe(99);
    expect(toClientGoalInput({ goalWeight: null }, {}).goalWeight).toBeNull();
  });
});
