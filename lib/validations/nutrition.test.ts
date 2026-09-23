import { describe, it, expect } from "vitest";
import { nutritionPlanSchema, nutritionRangeEditSchema } from "./nutrition";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";

// The route's belt on a custom-macro save, ahead of the orchestrator's: a
// stated target more than the tolerance from its macros' 4P + 4C + 9F is a
// 400 before any read. Both coach entries are the macro balancer, so a save
// from the app is inside one carb rounding by construction; this is against a
// raw API caller.
const custom = (customCalories: number) => ({
  proteinTargetGPerKg: 2.0,
  dietType: "balanced",
  includeActivityBurn: true,
  surplusAsCarbs: false,
  customMacrosEnabled: true,
  customProteinG: 150,
  customCarbG: 200,
  customFatG: 60, // 1,940 kcal
  customCalories,
});

describe("nutritionPlanSchema — the custom-macros belt", () => {
  it("refuses a target 40 kcal from its macros, on the calories field, naming the tolerance", () => {
    const parsed = nutritionPlanSchema.safeParse(custom(1980));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues[0];
    expect(issue.path).toEqual(["customCalories"]);
    expect(issue.message).toContain(`±${CUSTOM_MACRO_CALORIE_TOLERANCE} calories`);
  });

  it("the tolerance is 10 kcal: on the belt passes, past it fails", () => {
    expect(CUSTOM_MACRO_CALORIE_TOLERANCE).toBe(10);
    expect(nutritionPlanSchema.safeParse(custom(1950)).success).toBe(true);
    expect(nutritionPlanSchema.safeParse(custom(1951)).success).toBe(false);
    expect(nutritionPlanSchema.safeParse(custom(1930)).success).toBe(true);
    expect(nutritionPlanSchema.safeParse(custom(1929)).success).toBe(false);
  });

  it("a calculated save has no belt to trip", () => {
    expect(
      nutritionPlanSchema.safeParse({
        proteinTargetGPerKg: 2.0,
        dietType: "keto",
        includeActivityBurn: true,
        surplusAsCarbs: false,
      }).success
    ).toBe(true);
  });
});

// Every save states the version's two surplus settings (migration 196): they
// price only the days it covers, so a save without them has nothing to price
// its training days with.
describe("nutritionPlanSchema — the two surplus settings are required", () => {
  const calculated = { proteinTargetGPerKg: 1.8, dietType: "balanced" };

  it("accepts a save that states both", () => {
    expect(
      nutritionPlanSchema.safeParse({ ...calculated, includeActivityBurn: false, surplusAsCarbs: true }).success
    ).toBe(true);
  });

  it("refuses a save missing either one", () => {
    expect(nutritionPlanSchema.safeParse({ ...calculated, surplusAsCarbs: true }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse({ ...calculated, includeActivityBurn: false }).success).toBe(false);
    expect(nutritionPlanSchema.safeParse(calculated).success).toBe(false);
  });
});

// The per-day edit has one mode. "Adjust by" (a percent or kcal delta scaled
// per day) was removed on 2026-09-10; a delta body is a 400, not a silent
// fall-through to some other arithmetic.
describe("nutritionRangeEditSchema — absolute is the only edit", () => {
  const dates = ["2026-06-01", "2026-06-02"];

  it("accepts the sheet's payload: the calories and the three grams, one target for every day", () => {
    const parsed = nutritionRangeEditSchema.safeParse({
      dates,
      mode: "absolute",
      calories: 2400,
      proteinG: 180,
      carbG: 269,
      fatG: 67,
      note: "Big week",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a delta body — even one that carries a calorie target, so the mode itself is the gate", () => {
    const withTarget = nutritionRangeEditSchema.safeParse({
      dates,
      mode: "delta",
      calories: 2000,
      calorieDelta: -200,
    });
    expect(withTarget.success).toBe(false);
    if (!withTarget.success) expect(withTarget.error.issues[0].path).toEqual(["mode"]);
    expect(
      nutritionRangeEditSchema.safeParse({ dates, mode: "delta", percent: -10, holdProtein: false }).success
    ).toBe(false);
  });

  it("requires a positive calorie target", () => {
    expect(nutritionRangeEditSchema.safeParse({ dates, mode: "absolute" }).success).toBe(false);
    expect(nutritionRangeEditSchema.safeParse({ dates, mode: "absolute", calories: 0 }).success).toBe(false);
  });
});
