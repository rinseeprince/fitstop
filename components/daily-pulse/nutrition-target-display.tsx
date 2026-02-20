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
  // Build the "Assumes..." text for planned training/activities
  const buildAssumptionsText = () => {
    const parts: string[] = [];
    
    if (currentTrainingSession && nutritionTarget.trainingSessions.length > 0) {
      const sessionInfo = nutritionTarget.trainingSessions.find(s => s.name === currentTrainingSession.name);
      if (sessionInfo) {
        parts.push(`${sessionInfo.name} (${sessionInfo.calories} cal)`);
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

  const assumptionsText = buildAssumptionsText();

  return (
    <div className="text-center space-y-1">
      <div className="text-2xl font-semibold">
        Today's Target: {nutritionTarget.calories} cal
      </div>
      {assumptionsText && (
        <div className="text-sm text-muted-foreground">
          {assumptionsText}
        </div>
      )}
    </div>
  );
}