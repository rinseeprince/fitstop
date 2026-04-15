"use client";

import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { TrainingSession } from "@/types/training";
import type { TodaysActivity } from "./daily-pulse-content";

interface NutritionTargetDisplayProps {
  nutritionTarget: DailyNutritionTargets;
  currentTrainingSession: TrainingSession | null;
  plannedActivities: TodaysActivity[];
}

export function NutritionTargetDisplay({
  nutritionTarget,
  currentTrainingSession,
  plannedActivities,
}: NutritionTargetDisplayProps) {
  // Calculate dynamic plan target based on current session selection
  const calculatePlanTarget = () => {
    const baselineCalories = nutritionTarget.baselineCalories;
    if (nutritionTarget.includeActivityBurn === false) {
      return baselineCalories;
    }

    // New percentage model: surplus already computed in the target
    if (nutritionTarget.calorieSurplusPercentage != null) {
      return Math.round(baselineCalories * (1 + nutritionTarget.calorieSurplusPercentage / 100));
    }

    // Legacy flat burn model
    const currentSessionCalories = currentTrainingSession?.estimatedCalories || 0;
    const plannedActivityCalories = plannedActivities.reduce(
      (sum, activity) => sum + activity.estimatedCalories, 0
    );
    return baselineCalories + currentSessionCalories + plannedActivityCalories;
  };

  // Build the "Assumes..." text for planned training/activities
  const buildAssumptionsText = () => {
    // New percentage model: show surplus percentage
    if (nutritionTarget.calorieSurplusPercentage != null && currentTrainingSession) {
      return `Training day: +${nutritionTarget.calorieSurplusPercentage}% (${currentTrainingSession.name})`;
    }

    // Legacy flat burn model
    const parts: string[] = [];

    if (currentTrainingSession) {
      const calories = currentTrainingSession.estimatedCalories || 0;
      if (calories > 0) {
        parts.push(`${currentTrainingSession.name} (${calories} cal)`);
      }
    }

    if (plannedActivities.length > 0) {
      plannedActivities.forEach(activity => {
        if (activity.estimatedCalories > 0) {
          parts.push(`${activity.activityName} (${activity.estimatedCalories} cal)`);
        }
      });
    }

    if (parts.length === 0) {
      return null; // Rest day with no training or activities
    }

    return `Assumes ${parts.join(' + ')} completed`;
  };

  const planTarget = calculatePlanTarget();
  const assumptionsText = nutritionTarget.includeActivityBurn !== false
    ? buildAssumptionsText()
    : null;

  return (
    <div className="text-center space-y-1">
      <div className="text-2xl font-semibold">
        Today's Target: {planTarget} cal
      </div>
      {assumptionsText && (
        <div className="text-sm text-muted-foreground">
          {assumptionsText}
        </div>
      )}
    </div>
  );
}
