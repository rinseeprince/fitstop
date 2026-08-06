"use client";

import { AlertCircle } from "lucide-react";
import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { NutritionWarning } from "@/types/check-in";

type NutritionWarningsProps = {
  warnings: NutritionWarning[];
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Turns a calculator code into a sentence.
 *
 * `services/nutrition-service.ts` returns codes carrying raw kilograms rather
 * than finished strings: it is a pure module that runs in the coach's browser
 * AND on the server, so it cannot resolve a viewer preference. This component is
 * the first layer that can, which is why the two rate-cap warnings are worded
 * here instead of there.
 */
function describe(warning: NutritionWarning, viewer: UnitSystem): string {
  switch (warning.code) {
    case "deadline_passed":
      return "Goal deadline has passed. Using maintenance calories.";
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
      // Adding a code without a sentence is a compile error, not a blank bullet.
      const _exhaustive: never = warning;
      return _exhaustive;
    }
  }
}

export function NutritionWarnings({ warnings }: NutritionWarningsProps) {
  const { preference } = useUnits();

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="bg-warning/10 rounded-lg p-5 border border-warning/20">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-warning" />
        </div>
        <div className="flex-1 space-y-2">
          <p className="font-semibold text-foreground text-sm">
            Nutrition Plan Warnings
          </p>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-warning mt-0.5">•</span>
                <span>{describe(warning, preference)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
