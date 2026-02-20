"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  calculateAdjustedDayTarget,
  calculateAdjustedMacros,
  getCalorieFeedback
} from "@/utils/nutrition-tracking-helpers";
import { getFeedbackText, getFeedbackColor } from "./utils/nutrition-helpers";
import { createNutritionChangeHandlers } from "./utils/nutrition-change-handlers";
import { NutritionTargetDisplay } from "./nutrition-target-display";
import { MacroInputs } from "./macro-inputs";
import { NutritionSectionCompact } from "./nutrition-section-compact";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { TrainingSession } from "@/types/training";
import type { UnplannedActivity, TodaysActivity } from "./daily-pulse-content";

interface NutritionSectionProps {
  isExpanded: boolean;
  hasLoggedToday: boolean;
  nutritionTarget: DailyNutritionTargets | null;
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>;
  plannedActivities: TodaysActivity[];
  unplannedActivities: UnplannedActivity[];
  caloriesConsumed: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  savedTargets?: {
    adjustedCalories: number;
    adjustedProteinG: number;
    adjustedCarbsG: number;
    adjustedFatG: number;
  } | null;
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
  savedTargets,
  onNutritionChange,
}: NutritionSectionProps) {
  const [showMacros, setShowMacros] = useState(false);

  const calculateAdjustedTargets = () => {
    if (!nutritionTarget) {
      return { adjustedCalories: 0, adjustedProteinG: 0, adjustedCarbsG: 0, adjustedFatG: 0 };
    }

    const completedTrainingCals = sessionCompleted && currentTrainingSession 
      ? (currentTrainingSession.estimatedCalories || 0) : 0;

    const completedActivityCals = plannedActivities.reduce((sum, activity) => 
      sum + (activityStatuses[activity.sessionId]?.completed ? activity.estimatedCalories : 0), 0);

    const adjustedCalories = calculateAdjustedDayTarget(
      nutritionTarget.baselineCalories,
      completedTrainingCals,
      completedActivityCals
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

  const { adjustedCalories, adjustedProteinG, adjustedCarbsG, adjustedFatG } = 
    savedTargets || calculateAdjustedTargets();

  const calorieFeedback = getCalorieFeedback(caloriesConsumed, adjustedCalories);
  const proteinFeedback = getCalorieFeedback(proteinG, adjustedProteinG);
  const carbsFeedback = getCalorieFeedback(carbsG, adjustedCarbsG);
  const fatFeedback = getCalorieFeedback(fatG, adjustedFatG);

  const {
    handleCaloriesChange,
    handleProteinChange,
    handleCarbsChange,
    handleFatChange
  } = createNutritionChangeHandlers(
    onNutritionChange,
    { caloriesConsumed, proteinG, carbsG, fatG }
  );

  if (!isExpanded) {
    return (
      <NutritionSectionCompact
        caloriesConsumed={caloriesConsumed}
        nutritionTarget={nutritionTarget}
        calorieFeedback={calorieFeedback}
      />
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
        <NutritionTargetDisplay
          nutritionTarget={nutritionTarget}
          currentTrainingSession={currentTrainingSession}
          plannedActivities={plannedActivities}
        />
        
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
            {caloriesConsumed !== null && (
              <div className={`text-sm whitespace-nowrap ${getFeedbackColor(calorieFeedback.colour)}`}>
                {getFeedbackText(calorieFeedback, true)}
              </div>
            )}
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
            <MacroInputs
              proteinG={proteinG}
              carbsG={carbsG}
              fatG={fatG}
              adjustedProteinG={adjustedProteinG}
              adjustedCarbsG={adjustedCarbsG}
              adjustedFatG={adjustedFatG}
              proteinFeedback={proteinFeedback}
              carbsFeedback={carbsFeedback}
              fatFeedback={fatFeedback}
              hasLoggedToday={hasLoggedToday}
              isExpanded={isExpanded}
              onProteinChange={handleProteinChange}
              onCarbsChange={handleCarbsChange}
              onFatChange={handleFatChange}
              getFeedbackText={getFeedbackText}
              getFeedbackColor={getFeedbackColor}
            />
          )}
        </div>
      </div>
    </div>
  );
}