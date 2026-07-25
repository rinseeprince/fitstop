import { describe, it, expect } from "vitest";
import { detectGoalDrift } from "./detect-goal-drift";

const effective = (goalWeightKg: number | null, deadline: string | null) =>
  ({ goalWeightKg, deadline });

describe("detectGoalDrift", () => {
  it("no drift when weight + deadline match", () => {
    const d = detectGoalDrift({ goalWeightKg: 75, deadline: "2026-12-01" }, effective(75, "2026-12-01"));
    expect(d.changed).toBe(false);
  });

  it("ignores sub-epsilon weight noise (float / round-trip)", () => {
    const d = detectGoalDrift({ goalWeightKg: 75, deadline: "2026-12-01" }, effective(75.05, "2026-12-01"));
    expect(d.changed).toBe(false);
  });

  it("detects a changed goal weight", () => {
    const d = detectGoalDrift({ goalWeightKg: 75, deadline: "2026-12-01" }, effective(72, "2026-12-01"));
    expect(d.changed).toBe(true);
    expect(d.planGoalWeightKg).toBe(75);
    expect(d.currentGoalWeightKg).toBe(72);
  });

  it("detects a changed deadline", () => {
    const d = detectGoalDrift({ goalWeightKg: 75, deadline: "2026-12-01" }, effective(75, "2027-03-01"));
    expect(d.changed).toBe(true);
  });

  it("detects a goal appearing (null → set) and disappearing (set → null)", () => {
    expect(detectGoalDrift({ goalWeightKg: null, deadline: null }, effective(75, "2026-12-01")).changed).toBe(true);
    expect(detectGoalDrift({ goalWeightKg: 75, deadline: "2026-12-01" }, effective(null, null)).changed).toBe(true);
  });

  it("no drift when both are maintenance (null weight, no deadline)", () => {
    expect(detectGoalDrift({ goalWeightKg: null, deadline: null }, effective(null, null)).changed).toBe(false);
  });
});
