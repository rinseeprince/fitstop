import { describe, it, expect } from "vitest";
import { describeNutritionWarning } from "./nutrition-warnings";
import type { NutritionWarning } from "@/types/check-in";

// services/nutrition-service.ts is pure and runs in both the browser and the
// server, so it cannot resolve a viewer preference — it emits codes carrying raw
// KILOGRAMS. The save's toast words them in the viewer's unit, which is the
// whole point of the split: the same warning must read differently for two
// viewers.
describe("describeNutritionWarning", () => {
  const capped: NutritionWarning = { code: "deficit_capped", maxWeeklyChangeKg: 0.75 };

  it("says a metric viewer's cap in kilograms", () => {
    expect(describeNutritionWarning(capped, "metric")).toMatch(/0\.75 kg\/week/);
  });

  it("says the SAME warning in pounds for an imperial viewer", () => {
    // 0.75 kg -> 1.65 lbs. The old baked string said "0.75kg/week" to everyone.
    const text = describeNutritionWarning(capped, "imperial");
    expect(text).toMatch(/1\.65 lbs\/week/);
    expect(text).not.toMatch(/kg\/week/);
  });

  it("converts a surplus cap too", () => {
    expect(describeNutritionWarning({ code: "surplus_capped", maxWeeklyChangeKg: 0.5 }, "imperial")).toMatch(
      /1\.1 lbs\/week/
    );
  });

  it("leaves non-weight warnings identical across viewers", () => {
    const warnings: NutritionWarning[] = [
      { code: "protein_below_minimum" },
      { code: "calories_raised_to_minimum", minimumCalories: 1500 },
      { code: "fat_increased_for_minimum", gender: "female" },
    ];
    const metric = warnings.map((warning) => describeNutritionWarning(warning, "metric")).join(" ");
    const imperial = warnings.map((warning) => describeNutritionWarning(warning, "imperial")).join(" ");

    expect(imperial).toBe(metric);
    expect(metric).toContain("1.6g/kg");
    expect(metric).toContain("1500 cal/day");
    expect(metric).toContain("25%");
  });

  it("says a deadline on or before the plan's first day holds it at maintenance — never that it has passed", () => {
    // A deadline on the first day has not passed; it leaves no days all the
    // same, because the deadline is the weigh-in (commit 9b).
    const text = describeNutritionWarning({ code: "deadline_passed" }, "metric");
    expect(text).toBe("Goal deadline is on or before the day this plan starts. Using maintenance calories.");
    expect(text).not.toMatch(/has passed/);
  });
});
