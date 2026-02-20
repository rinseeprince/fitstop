"use client";

import { Badge } from "@/components/ui/badge";
import { 
  getFeedbackText, 
  getFeedbackColor,
  type CalorieFeedback 
} from "@/utils/nutrition-tracking-helpers";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";

interface NutritionSectionCompactProps {
  caloriesConsumed: number | null;
  nutritionTarget: DailyNutritionTargets | null;
  adjustedCalories: number;
  calorieFeedback: CalorieFeedback;
}

export function NutritionSectionCompact({
  caloriesConsumed,
  nutritionTarget,
  adjustedCalories,
  calorieFeedback,
}: NutritionSectionCompactProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Nutrition</span>
        {caloriesConsumed !== null && nutritionTarget && (
          <Badge variant="secondary">
            {caloriesConsumed} / {adjustedCalories} cal
          </Badge>
        )}
      </div>
      {caloriesConsumed !== null && (
        <div className={`text-sm ${getFeedbackColor(calorieFeedback.colour)}`}>
          {getFeedbackText(calorieFeedback, true)}
        </div>
      )}
    </div>
  );
}