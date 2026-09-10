import { describe, it, expect } from "vitest";
import { nutritionPlanSchema } from "./nutrition";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";

// The route's belt on a custom-macro save, ahead of the orchestrator's: a
// stated target more than the tolerance from its macros' 4P + 4C + 9F is a
// 400 before any read. Both coach entries are the macro balancer, so a save
// from the app is inside one carb rounding by construction; this is against a
// raw API caller.
const custom = (customCalories: number) => ({
  proteinTargetGPerKg: 2.0,
  dietType: "balanced",
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
      nutritionPlanSchema.safeParse({ proteinTargetGPerKg: 2.0, dietType: "keto" }).success
    ).toBe(true);
  });
});
