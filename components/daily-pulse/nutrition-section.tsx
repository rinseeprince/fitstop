"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  calculateAdjustedDayTarget,
  calculateAdjustedMacros,
  getCalorieFeedback,
  calculateUnplannedActivityCalories,
  type CalorieFeedback
} from "@/utils/nutrition-tracking-helpers";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { TrainingSession } from "@/types/training";

type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};

type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
};

interface NutritionSectionProps {
  isExpanded: boolean;
  hasLoggedToday: boolean;
  nutritionTarget: DailyNutritionTargets | null;
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  activityStatuses: Record<string, boolean>;
  plannedActivities: TodaysActivity[];
  unplannedActivities: UnplannedActivity[];
  caloriesConsumed: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  onNutritionChange: (data: {
    caloriesConsumed: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  }) => void;
}

export function NutritionSection({
  isExpanded,
  hasLoggedToday,
  nutritionTarget,
  sessionCompleted,
  currentTrainingSession,
  activityStatuses,
  plannedActivities,
  unplannedActivities,
  caloriesConsumed,
  proteinG,
  carbsG,
  fatG,
  onNutritionChange,
}: NutritionSectionProps) {
  const [showMacros, setShowMacros] = useState(false);

  const calculateAdjustedTargets = () => {
    if (!nutritionTarget) {
      return {
        adjustedCalories: 0,
        adjustedProteinG: 0,
        adjustedCarbsG: 0,
        adjustedFatG: 0
      };
    }

    const completedTrainingCals = sessionCompleted && currentTrainingSession 
      ? (currentTrainingSession.estimatedCalories || 0) 
      : 0;

    const completedActivityCals = plannedActivities.reduce((sum, activity) => 
      sum + (activityStatuses[activity.sessionId] ? activity.estimatedCalories : 0), 0
    );

    const unplannedActivityCals = unplannedActivities.reduce((sum, activity) => 
      sum + calculateUnplannedActivityCalories(activity), 0
    );

    const adjustedCalories = calculateAdjustedDayTarget(
      nutritionTarget.calories,
      completedTrainingCals,
      0, 
      completedActivityCals,
      0, 
      unplannedActivityCals
    );

    const adjustedMacros = calculateAdjustedMacros(
      adjustedCalories,
      nutritionTarget.proteinG,
      nutritionTarget.carbsG,
      nutritionTarget.fatG
    );

    return {
      adjustedCalories,
      adjustedProteinG: adjustedMacros.proteinG,
      adjustedCarbsG: adjustedMacros.carbsG,
      adjustedFatG: adjustedMacros.fatG
    };
  };

  const { adjustedCalories, adjustedProteinG, adjustedCarbsG, adjustedFatG } = calculateAdjustedTargets();

  const calorieFeedback = getCalorieFeedback(caloriesConsumed, adjustedCalories);
  const proteinFeedback = getCalorieFeedback(proteinG, adjustedProteinG);
  const carbsFeedback = getCalorieFeedback(carbsG, adjustedCarbsG);
  const fatFeedback = getCalorieFeedback(fatG, adjustedFatG);

  const getFeedbackText = (feedback: CalorieFeedback, isCalories: boolean = false): string => {
    if (feedback.direction === "exact") {
      return "Perfect!";
    }
    const prefix = feedback.direction === "over" ? "+" : "-";
    const value = isCalories ? feedback.difference : feedback.difference;
    const unit = isCalories ? " cal" : "g";
    const suffix = feedback.direction === "over" ? " over target" : " under target";
    return `${prefix}${value}${unit}${suffix}`;
  };

  const getFeedbackColor = (colour: string): string => {
    switch (colour) {
      case "green": return "text-green-600";
      case "amber": return "text-amber-600";
      case "red": return "text-red-600";
      default: return "text-muted-foreground";
    }
  };

  const handleCaloriesChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      caloriesConsumed: numValue,
      proteinG,
      carbsG,
      fatG
    });
  };

  const handleProteinChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      caloriesConsumed,
      proteinG: numValue,
      carbsG,
      fatG
    });
  };

  const handleCarbsChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      caloriesConsumed,
      proteinG,
      carbsG: numValue,
      fatG
    });
  };

  const handleFatChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      caloriesConsumed,
      proteinG,
      carbsG,
      fatG: numValue
    });
  };

  if (!isExpanded) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Nutrition</span>
          {caloriesConsumed && (
            <Badge variant="secondary">
              {caloriesConsumed} / {adjustedCalories} cal
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

  if (!nutritionTarget) {
    return (
      <div className="space-y-4">
        <Label className="text-base">Nutrition</Label>
        <div className="text-sm text-muted-foreground">
          No nutrition targets available for today
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Label className="text-base">Nutrition</Label>
      
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-2xl font-semibold">
            Today's Target: {adjustedCalories} cal
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="calories">Calories Consumed</Label>
          <div className="flex items-center gap-2">
            <Input
              id="calories"
              type="number"
              value={caloriesConsumed || ""}
              onChange={(e) => handleCaloriesChange(e.target.value)}
              placeholder="0"
              className="text-lg h-12"
              disabled={!hasLoggedToday && !isExpanded}
            />
            <div className={`text-sm whitespace-nowrap ${getFeedbackColor(calorieFeedback.colour)}`}>
              {getFeedbackText(calorieFeedback, true)}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowMacros(!showMacros)}
            className="flex items-center gap-1 h-auto p-0 font-normal"
          >
            {showMacros ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Log Macros (Optional)
          </Button>
          
          {showMacros && (
            <div className="space-y-3 pl-4 border-l-2 border-muted">
              <div className="space-y-1">
                <Label htmlFor="protein">Protein (g)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="protein"
                    type="number"
                    value={proteinG || ""}
                    onChange={(e) => handleProteinChange(e.target.value)}
                    placeholder="0"
                    disabled={!hasLoggedToday && !isExpanded}
                  />
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    Target: {adjustedProteinG}g
                  </div>
                  {proteinG !== null && (
                    <div className={`text-sm whitespace-nowrap ${getFeedbackColor(proteinFeedback.colour)}`}>
                      {getFeedbackText(proteinFeedback)}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="carbs">Carbs (g)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="carbs"
                    type="number"
                    value={carbsG || ""}
                    onChange={(e) => handleCarbsChange(e.target.value)}
                    placeholder="0"
                    disabled={!hasLoggedToday && !isExpanded}
                  />
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    Target: {adjustedCarbsG}g
                  </div>
                  {carbsG !== null && (
                    <div className={`text-sm whitespace-nowrap ${getFeedbackColor(carbsFeedback.colour)}`}>
                      {getFeedbackText(carbsFeedback)}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="fat">Fat (g)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="fat"
                    type="number"
                    value={fatG || ""}
                    onChange={(e) => handleFatChange(e.target.value)}
                    placeholder="0"
                    disabled={!hasLoggedToday && !isExpanded}
                  />
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    Target: {adjustedFatG}g
                  </div>
                  {fatG !== null && (
                    <div className={`text-sm whitespace-nowrap ${getFeedbackColor(fatFeedback.colour)}`}>
                      {getFeedbackText(fatFeedback)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}