import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { NutritionWarning } from "@/types/check-in";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A calculator warning as the sentence the plan save's toast says
 * (docs/MEASUREMENT-LOG-PLAN.md commit 9c).
 *
 * `services/nutrition-service.ts` returns codes carrying raw kilograms rather
 * than finished strings: it is a pure module that runs in the coach's browser
 * AND on the server, so it cannot resolve a viewer preference. The save is the
 * first layer that can, which is why the two rate-cap warnings are worded here
 * instead of there.
 */
export function describeNutritionWarning(warning: NutritionWarning, viewer: UnitSystem): string {
  switch (warning.code) {
    // A deadline on the plan's first day has not passed, and leaves no days
    // all the same: the deadline is the weigh-in.
    case "deadline_passed":
      return "Goal deadline is on or before the day this plan starts. Using maintenance calories.";
    case "deficit_capped": {
      const { value, unit } = formatWeight(warning.maxWeeklyChangeKg, viewer);
      return `Weekly deficit capped at ${round2(value)} ${unit}/week for safety. Goal timeline may need adjustment.`;
    }
    case "surplus_capped": {
      const { value, unit } = formatWeight(warning.maxWeeklyChangeKg, viewer);
      return `Weekly surplus capped at ${round2(value)} ${unit}/week for optimal muscle gain. Goal timeline may need adjustment.`;
    }
    case "calories_raised_to_minimum":
      return `Calorie target raised to minimum safe level (${warning.minimumCalories} cal/day). Consider adjusting goal timeline.`;
    case "protein_below_minimum":
      return "Protein target is below recommended minimum (1.6g/kg). Consider increasing for better results.";
    case "protein_above_necessary":
      return "Protein target is higher than necessary (>2.5g/kg). Excess protein provides no additional benefit.";
    case "protein_exceeds_calories":
      return "Protein alone exceeds calorie target. Adjusting protein down to fit.";
    case "fat_increased_for_minimum":
      return `Fat intake increased to meet ${warning.gender === "female" ? "25%" : "20%"} minimum for hormonal health.`;
    default: {
      // Adding a code without a sentence is a compile error, not a blank sentence.
      const _exhaustive: never = warning;
      return _exhaustive;
    }
  }
}
