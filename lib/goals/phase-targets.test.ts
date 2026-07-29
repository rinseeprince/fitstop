import { describe, it, expect } from "vitest";
import { computePhaseTargets } from "./phase-targets";

const PHASES = [
  { id: "p1", name: "Cut 1", startsOn: "2026-08-01", endsOn: "2026-08-28", ratePerWeekKg: -0.5 },
  { id: "p2", name: "Diet break", startsOn: "2026-08-29", endsOn: "2026-09-11", ratePerWeekKg: 0 },
  { id: "p3", name: "Cut 2", startsOn: "2026-09-12", endsOn: "2026-10-09", ratePerWeekKg: -0.75 },
];

const BASE = {
  tdee: 2500,
  gender: "male" as const,
  proteinTargetG: 160,
  dietType: "balanced" as const,
};

describe("computePhaseTargets", () => {
  it("gives each block its OWN calorie target, from its own rate", () => {
    const rows = computePhaseTargets({ ...BASE, phases: PHASES });

    // -0.5 kg/wk = -550 cal/day; 0 = maintenance; -0.75 = -825 cal/day.
    expect(rows.map((r) => r.baselineCalories)).toEqual([1950, 2500, 1675]);
    expect(rows.map((r) => r.name)).toEqual(["Cut 1", "Diet break", "Cut 2"]);
  });

  it("a rate of 0 is maintenance — TDEE exactly, not a missing target", () => {
    const [, breakRow] = computePhaseTargets({ ...BASE, phases: PHASES });
    expect(breakRow.baselineCalories).toBe(2500);
    expect(breakRow.requestedRateKgPerWeek).toBe(0);
    expect(breakRow.appliedRateKgPerWeek).toBe(0);
    expect(breakRow.warnings).toEqual([]);
  });

  it("writes a 7-row grid per block in the five-key shape migration 137 expects", () => {
    const [row] = computePhaseTargets({ ...BASE, phases: PHASES });

    expect(row.dailyTargets).toHaveLength(7);
    for (const day of row.dailyTargets) {
      // is_training_day is deliberately ABSENT: it is a per-DATE fact derived
      // from live training events, which a weekday grid cannot carry.
      expect(Object.keys(day).sort()).toEqual([
        "calories", "carb_g", "day_of_week", "fat_g", "protein_g",
      ]);
      expect(day.calories).toBe(row.baselineCalories);
    }
    expect(row.dailyTargets.map((d) => d.day_of_week)).toEqual([
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    ]);
  });

  it("surfaces a capped rate PER ROW (invariant 12: a cap is never silent)", () => {
    // TDEE 3000 so the capped -1 kg/wk (-1100 cal/day) lands at 1900 — above the
    // 1500 floor, isolating the cap.
    const [row] = computePhaseTargets({
      ...BASE,
      tdee: 3000,
      phases: [{ ...PHASES[0], ratePerWeekKg: -2 }],
    });

    expect(row.capped).toBe(true);
    expect(row.floored).toBe(false);
    expect(row.capKgPerWeek).toBe(1);
    expect(row.requestedRateKgPerWeek).toBe(-2);
    expect(row.appliedRateKgPerWeek).toBe(-1);
    expect(row.baselineCalories).toBe(1900);
    expect(row.warnings.some((w) => w.includes("capped at 1kg/week"))).toBe(true);
  });

  it("cap and floor can BOTH bite, and the applied rate reflects both", () => {
    // The interaction task 1.4's matrix flagged: at TDEE 2500 the capped
    // -1 kg/wk wants 1400, which then trips the 1500 floor. The block ends up
    // running -0.909 kg/wk — neither the -2 requested nor the -1 cap.
    const [row] = computePhaseTargets({
      ...BASE,
      phases: [{ ...PHASES[0], ratePerWeekKg: -2 }],
    });

    expect(row.capped).toBe(true);
    expect(row.floored).toBe(true);
    expect(row.baselineCalories).toBe(1500);
    expect(row.requestedRateKgPerWeek).toBe(-2);
    expect(row.appliedRateKgPerWeek).toBeCloseTo(-0.9091, 4);
    expect(row.warnings).toHaveLength(2);
  });

  it("a floored block reports the rate it will run, not the one requested", () => {
    // Task 2.8(d). At TDEE 1700 a -0.75 kg/wk request wants 875 cal/day, which
    // lands under the 1500 floor — so the block actually runs only 200/day.
    const [row] = computePhaseTargets({
      ...BASE,
      tdee: 1700,
      phases: [{ ...PHASES[0], ratePerWeekKg: -0.75 }],
    });

    expect(row.floored).toBe(true);
    expect(row.baselineCalories).toBe(1500);
    expect(row.requestedRateKgPerWeek).toBe(-0.75);
    expect(row.appliedRateKgPerWeek).toBeCloseTo(-0.1818, 4);
    expect(row.warnings.some((w) => w.includes("minimum safe level"))).toBe(true);
  });

  it("discloses an assumed safety envelope only when a limit actually applied", () => {
    // Task 2.8(e): unset gender takes the male envelope. Say so when it bites.
    const bites = computePhaseTargets({
      ...BASE,
      gender: null,
      phases: [{ ...PHASES[0], ratePerWeekKg: -2 }],
    });
    expect(bites[0].warnings.some((w) => w.includes("no gender set"))).toBe(true);

    const doesNot = computePhaseTargets({
      ...BASE,
      gender: null,
      phases: [{ ...PHASES[0], ratePerWeekKg: -0.5 }],
    });
    expect(doesNot[0].warnings).toEqual([]);
  });

  it("an explicit 'other' assumes nothing — the coach chose it", () => {
    const other = computePhaseTargets({
      ...BASE,
      gender: "other",
      phases: [{ ...PHASES[0], ratePerWeekKg: -2 }],
    });
    expect(other[0].warnings.some((w) => w.includes("no gender set"))).toBe(false);
    expect(other[0].capKgPerWeek).toBe(1); // still the male envelope
  });

  it("returns nothing for a client with no blocks", () => {
    expect(computePhaseTargets({ ...BASE, phases: [] })).toEqual([]);
  });
});
