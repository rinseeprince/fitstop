"use client";

import { Badge } from "@/components/ui/badge";
import { getFeedbackText, getFeedbackColor } from "./utils/nutrition-helpers";
import type { CalorieFeedback } from "@/utils/nutrition-tracking-helpers";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";

interface NutritionSectionCompactProps {
  caloriesConsumed: number | null;
  nutritionTarget: DailyNutritionTargets | null;
  calorieFeedback: CalorieFeedback;
}

export function NutritionSectionCompact({
  caloriesConsumed,
  nutritionTarget,
  calorieFeedback,
}: NutritionSectionCompactProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Nutrition</span>
        {caloriesConsumed && nutritionTarget && (
          <Badge variant="secondary">
            {caloriesConsumed} / {nutritionTarget.calories} cal
          </Badge>
        )}
      </div>
      {caloriesConsumed && (
        <div className={`text-sm ${getFeedbackColor(calorieFeedback.colour)}`}>
          {getFeedbackText(calorieFeedback, true)}
        </div>
      )}
    </div>
  );
}