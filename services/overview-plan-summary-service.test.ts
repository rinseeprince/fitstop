import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("./training-service", () => ({ getTrainingPlanForDate: vi.fn() }));
vi.mock("./training-week-summary-service", () => ({ getTrainingWeekSummary: vi.fn() }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("./daily-context-service", () => ({ getNutritionForDate: vi.fn() }));
vi.mock("./exercise-analytics-service", () => ({
  getClientExerciseList: vi.fn(),
  getExerciseProgressionSeries: vi.fn(),
}));

import { modalSurplus, progressionFromSeries } from "./overview-plan-summary-service";

describe("modalSurplus", () => {
  it("returns the most frequent non-null surplus", () => {
    expect(
      modalSurplus([
        { calorie_surplus_percentage: 15 },
        { calorie_surplus_percentage: 15 },
        { calorie_surplus_percentage: 10 },
        { calorie_surplus_percentage: null },
      ])
    ).toBe(15);
  });

  it("breaks frequency ties toward the larger value", () => {
    expect(
      modalSurplus([
        { calorie_surplus_percentage: 10 },
        { calorie_surplus_percentage: 15 },
      ])
    ).toBe(15);
  });

  it("returns null when no event carries a surplus", () => {
    expect(modalSurplus([])).toBeNull();
    expect(modalSurplus([{ calorie_surplus_percentage: null }])).toBeNull();
  });
});

describe("progressionFromSeries", () => {
  const effectiveFrom = "2026-06-01";

  const point = (date: string, e1rm: number | null) => ({
    date,
    estimatedOneRepMax: e1rm,
  });

  it("averages per-exercise best-e1RM change between the first logged week and the current week", () => {
    const series = [
      // Bench: week 1 best 100 → week 4 best 110 (+10%)
      { points: [point("2026-06-02", 95), point("2026-06-04", 100), point("2026-06-23", 110)] },
      // Squat: week 1 best 140 → week 4 best 147 (+5%)
      { points: [point("2026-06-03", 140), point("2026-06-24", 147)] },
    ];
    expect(progressionFromSeries(series, effectiveFrom, 4)).toBe(7.5);
  });

  it("only averages exercises present in BOTH weeks", () => {
    const series = [
      { points: [point("2026-06-02", 100), point("2026-06-23", 110)] }, // +10%
      { points: [point("2026-06-23", 200)] }, // current week only → excluded
    ];
    expect(progressionFromSeries(series, effectiveFrom, 4)).toBe(10);
  });

  it("returns null when the first logged week IS the current week", () => {
    const series = [{ points: [point("2026-06-02", 100)] }];
    expect(progressionFromSeries(series, effectiveFrom, 1)).toBeNull();
  });

  it("returns null with no points or no overlapping exercises", () => {
    expect(progressionFromSeries([], effectiveFrom, 3)).toBeNull();
    const disjoint = [
      { points: [point("2026-06-02", 100)] }, // week 1 only
      { points: [point("2026-06-16", 120)] }, // week 3 only
    ];
    expect(progressionFromSeries(disjoint, effectiveFrom, 3)).toBeNull();
  });

  it("ignores null e1RMs and points before the plan start", () => {
    const series = [
      {
        points: [
          point("2026-05-20", 500), // pre-plan → ignored
          point("2026-06-02", null), // no e1RM → ignored
          point("2026-06-03", 100),
          point("2026-06-17", 104),
        ],
      },
    ];
    expect(progressionFromSeries(series, effectiveFrom, 3)).toBe(4);
  });
});
