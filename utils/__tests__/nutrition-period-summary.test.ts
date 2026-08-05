import { describe, it, expect } from "vitest";
import { buildNutritionSummary } from "../nutrition-period-summary";
import type { NutritionPlanWithTargets, NutritionLogRow } from "@/services/schedule-data-service";
import type { NutritionEvent } from "@/types/check-in";

// --- Fixtures ---

const makePlan = (overrides: Partial<NutritionPlanWithTargets> = {}): NutritionPlanWithTargets => ({
  id: "nplan-1",
  effectiveFrom: "2026-03-30",
  effectiveUntil: null,
  dailyTargets: [
    { dayOfWeek: "monday", calories: 2200, proteinG: 160, carbG: 250, fatG: 70 },
    { dayOfWeek: "tuesday", calories: 2000, proteinG: 150, carbG: 220, fatG: 65 },
    { dayOfWeek: "wednesday", calories: 2200, proteinG: 160, carbG: 250, fatG: 70 },
    { dayOfWeek: "thursday", calories: 2000, proteinG: 150, carbG: 220, fatG: 65 },
    { dayOfWeek: "friday", calories: 2200, proteinG: 160, carbG: 250, fatG: 70 },
    { dayOfWeek: "saturday", calories: 1800, proteinG: 140, carbG: 200, fatG: 60 },
    { dayOfWeek: "sunday", calories: 1800, proteinG: 140, carbG: 200, fatG: 60 },
  ],
  ...overrides,
});

const makeLog = (overrides: Partial<NutritionLogRow> = {}): NutritionLogRow => ({
  date: "2026-03-30",
  caloriesConsumed: 2180,
  proteinG: 155,
  carbsG: 245,
  fatG: 68,
  targetCalories: 2200,
  targetProteinG: 160,
  targetCarbsG: 250,
  targetFatG: 70,
  ...overrides,
});

describe("buildNutritionSummary", () => {
  it("returns hit when actual is within 50 calories of target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"], // Monday
      [makePlan()],
      [makeLog({ caloriesConsumed: 2180 })] // diff = 20
    );

    expect(result[0].status).toBe("hit");
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].actualCalories).toBe(2180);
  });

  it("returns hit at exactly 50 calorie threshold", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ caloriesConsumed: 2150 })] // diff = 50
    );

    expect(result[0].status).toBe("hit");
  });

  it("returns partial when actual is within 200 calories of target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ caloriesConsumed: 2100 })] // diff = 100
    );

    expect(result[0].status).toBe("partial");
  });

  it("returns partial at exactly 200 calorie threshold", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ caloriesConsumed: 2000 })] // diff = 200
    );

    expect(result[0].status).toBe("partial");
  });

  it("returns missed when actual is more than 200 calories off target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ caloriesConsumed: 1900 })] // diff = 300
    );

    expect(result[0].status).toBe("missed");
  });

  it("returns not_logged when no nutrition log exists for a date", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [] // no logs
    );

    expect(result[0].status).toBe("not_logged");
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].actualCalories).toBeNull();
  });

  it("returns not_logged with null targets when no plan exists for date", () => {
    const plan = makePlan({ effectiveFrom: "2026-04-01" }); // starts after the date

    const result = buildNutritionSummary(
      ["2026-03-30"],
      [plan],
      []
    );

    expect(result[0].status).toBe("not_logged");
    expect(result[0].targetCalories).toBeNull();
    expect(result[0].actualCalories).toBeNull();
  });

  it("returns not_logged when log has null calories_consumed", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ caloriesConsumed: null })]
    );

    expect(result[0].status).toBe("not_logged");
  });

  it("generates full week with mixed statuses", () => {
    const dates = [
      "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
      "2026-04-03", "2026-04-04", "2026-04-05",
    ];

    const logs: NutritionLogRow[] = [
      makeLog({ date: "2026-03-30", caloriesConsumed: 2200, targetCalories: 2200 }),  // Mon: hit (diff=0)
      makeLog({ date: "2026-03-31", caloriesConsumed: 1850, targetCalories: 2000 }),  // Tue: partial (diff=150)
      // Wed: not_logged
      makeLog({ date: "2026-04-02", caloriesConsumed: 1500, targetCalories: 2000 }),  // Thu: missed (diff=500)
      makeLog({ date: "2026-04-03", caloriesConsumed: 2190, targetCalories: 2200 }),  // Fri: hit (diff=10)
      // Sat: not_logged
      // Sun: not_logged
    ];

    const result = buildNutritionSummary(dates, [makePlan()], logs);

    expect(result).toHaveLength(7);
    expect(result[0].status).toBe("hit");        // Mon
    expect(result[1].status).toBe("partial");     // Tue
    expect(result[2].status).toBe("not_logged");  // Wed
    expect(result[3].status).toBe("missed");      // Thu
    expect(result[4].status).toBe("hit");         // Fri
    expect(result[5].status).toBe("not_logged");  // Sat
    expect(result[6].status).toBe("not_logged");  // Sun
  });

  it("populates macro fields correctly", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ proteinG: 155, carbsG: 245, fatG: 68 })]
    );

    expect(result[0].targetProteinG).toBe(160);
    expect(result[0].targetCarbsG).toBe(250);
    expect(result[0].targetFatG).toBe(70);
    expect(result[0].actualProteinG).toBe(155);
    expect(result[0].actualCarbsG).toBe(245);
    expect(result[0].actualFatG).toBe(68);
  });

  it("uses nutrition event targets over template for unlogged days", () => {
    const event: NutritionEvent = {
      id: "ne-1",
      clientId: "c1",
      nutritionPlanId: "np-1",
      date: "2026-03-30",
      dayOfWeek: "monday",
      baselineCalories: 2000,
      trainingBurnCalories: 300,
      proteinG: 160,
      carbG: 250,
      fatG: 70,
      dietType: "balanced",
      isTrainingDay: true,
      calorieSurplusPercentage: null,
      isModified: false,
      note: null,
      coachNote: null,
      status: "scheduled",
      createdAt: "",
      updatedAt: "",
    };

    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [], // no logs — unlogged day
      undefined,
      [event]
    );

    // Event target = baseline + training = 2000 + 300 = 2300
    expect(result[0].targetCalories).toBe(2300);
    expect(result[0].targetProteinG).toBe(160);
    expect(result[0].targetCarbsG).toBe(250);
    expect(result[0].targetFatG).toBe(70);
    expect(result[0].status).toBe("not_logged");
  });

  it("prefers logged target over event target", () => {
    const event: NutritionEvent = {
      id: "ne-1",
      clientId: "c1",
      nutritionPlanId: "np-1",
      date: "2026-03-30",
      dayOfWeek: "monday",
      baselineCalories: 2000,
      trainingBurnCalories: 300,
      proteinG: 160,
      carbG: 250,
      fatG: 70,
      dietType: "balanced",
      isTrainingDay: true,
      calorieSurplusPercentage: null,
      isModified: false,
      note: null,
      coachNote: null,
      status: "logged",
      createdAt: "",
      updatedAt: "",
    };

    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makePlan()],
      [makeLog({ targetCalories: 2200, caloriesConsumed: 2180 })],
      undefined,
      [event]
    );

    // Logged target (2200) takes priority over event target (2350)
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].status).toBe("hit");
  });
});
