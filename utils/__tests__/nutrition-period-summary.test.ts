import { describe, it, expect } from "vitest";
import { buildNutritionSummary } from "../nutrition-period-summary";
import type { NutritionLogRow } from "@/services/schedule-data-service";
import type { NutritionDayTarget } from "@/services/nutrition-days-service";

// --- Fixtures ---

const makeLog = (overrides: Partial<NutritionLogRow> = {}): NutritionLogRow => ({
  date: "2026-03-30",
  caloriesConsumed: 2180,
  proteinG: 155,
  carbsG: 245,
  fatG: 68,
  ...overrides,
});

const target = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 160,
  carbsG: 250,
  fatG: 70,
  isTrainingDay: false,
  note: null,
});

const targets = (...entries: NutritionDayTarget[]) =>
  new Map(entries.map((entry) => [entry.date, entry]));

const MONDAY = targets(target("2026-03-30", 2200));

describe("buildNutritionSummary", () => {
  it("returns hit when actual is within 50 calories of target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 2180 })], // diff = 20
      MONDAY
    );

    expect(result[0].status).toBe("hit");
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].actualCalories).toBe(2180);
  });

  it("returns hit at exactly 50 calorie threshold", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 2150 })], // diff = 50
      MONDAY
    );

    expect(result[0].status).toBe("hit");
  });

  it("returns partial when actual is within 200 calories of target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 2100 })], // diff = 100
      MONDAY
    );

    expect(result[0].status).toBe("partial");
  });

  it("returns partial at exactly 200 calorie threshold", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 2000 })], // diff = 200
      MONDAY
    );

    expect(result[0].status).toBe("partial");
  });

  it("returns missed when actual is more than 200 calories off target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 1900 })], // diff = 300
      MONDAY
    );

    expect(result[0].status).toBe("missed");
  });

  it("returns not_logged when no nutrition log exists for a date", () => {
    const result = buildNutritionSummary(["2026-03-30"], [], MONDAY);

    expect(result[0].status).toBe("not_logged");
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].actualCalories).toBeNull();
  });

  it("returns not_logged with null targets when no version covers the date", () => {
    const result = buildNutritionSummary(["2026-03-30"], [], targets());

    expect(result[0].status).toBe("not_logged");
    expect(result[0].targetCalories).toBeNull();
    expect(result[0].actualCalories).toBeNull();
  });

  // The food log stores what the client ate and nothing else: a logged day on
  // a date no version covers shows its meals with no target and no verdict.
  it("a logged day with no computed target keeps its meals and carries no verdict", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 2180 })],
      targets()
    );

    expect(result[0].actualCalories).toBe(2180);
    expect(result[0].targetCalories).toBeNull();
    expect(result[0].status).toBe("not_logged");
  });

  it("returns not_logged when log has null calories_consumed", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: null })],
      MONDAY
    );

    expect(result[0].status).toBe("not_logged");
  });

  it("generates full week with mixed statuses, each day against its own computed target", () => {
    const dates = [
      "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
      "2026-04-03", "2026-04-04", "2026-04-05",
    ];

    const logs: NutritionLogRow[] = [
      makeLog({ date: "2026-03-30", caloriesConsumed: 2200 }), // Mon: hit (diff=0)
      makeLog({ date: "2026-03-31", caloriesConsumed: 1850 }), // Tue: partial (diff=150)
      // Wed: not_logged
      makeLog({ date: "2026-04-02", caloriesConsumed: 1500 }), // Thu: missed (diff=500)
      makeLog({ date: "2026-04-03", caloriesConsumed: 2190 }), // Fri: hit (diff=10)
      // Sat: not_logged
      // Sun: not_logged
    ];

    const week = targets(
      target("2026-03-30", 2200),
      target("2026-03-31", 2000),
      target("2026-04-01", 2200),
      target("2026-04-02", 2000),
      target("2026-04-03", 2200),
      target("2026-04-04", 1800),
      target("2026-04-05", 1800)
    );

    const result = buildNutritionSummary(dates, logs, week);

    expect(result).toHaveLength(7);
    expect(result.map((day) => day.status)).toEqual([
      "hit", "partial", "not_logged", "missed", "hit", "not_logged", "not_logged",
    ]);
    expect(result.map((day) => day.targetCalories)).toEqual([2200, 2000, 2200, 2000, 2200, 1800, 1800]);
  });

  it("populates macro fields from the log (actual) and the computed day (target)", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ proteinG: 155, carbsG: 245, fatG: 68 })],
      MONDAY
    );

    expect(result[0].targetProteinG).toBe(160);
    expect(result[0].targetCarbsG).toBe(250);
    expect(result[0].targetFatG).toBe(70);
    expect(result[0].actualProteinG).toBe(155);
    expect(result[0].actualCarbsG).toBe(245);
    expect(result[0].actualFatG).toBe(68);
  });

  // A logged day's target is the computed day's, the same source as an
  // unlogged day's — a target the row might still carry (until migration 173
  // drops the columns) is never preferred over it.
  it("a logged day and an unlogged day take their target from the same computed source, never the row", () => {
    const week = targets(target("2026-03-30", 2300), target("2026-03-31", 2300));
    const stale: (NutritionLogRow & { targetCalories: number; targetProteinG: number })[] = [
      { ...makeLog({ date: "2026-03-30", caloriesConsumed: 2290 }), targetCalories: 9999, targetProteinG: 1 },
    ];
    const result = buildNutritionSummary(["2026-03-30", "2026-03-31"], stale, week);

    expect(result[0]).toMatchObject({ targetCalories: 2300, targetProteinG: 160, status: "hit" });
    expect(result[1]).toMatchObject({ targetCalories: 2300, status: "not_logged" });
  });
});
