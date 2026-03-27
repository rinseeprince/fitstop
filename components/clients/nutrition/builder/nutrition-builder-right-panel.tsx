"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionPlanHeader } from "../display/nutrition-plan-header";
import { WeeklyNutritionView } from "../display/weekly-nutrition-view";
import { NutritionWarnings } from "../nutrition-warnings";
import { Button } from "@/components/ui/button";
import { Apple, Loader2, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { weightFromKg } from "@/utils/nutrition-helpers";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();

  // Loading state for training plan
  if (builder.isLoadingTrainingPlan) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/50 rounded-lg">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Empty state - no nutrition plan
  if (!builder.hasPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center mb-4">
          <Apple className="h-8 w-8 text-warning" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No nutrition plan yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Generate a customized nutrition plan based on your client&apos;s goals, activity level, and training schedule.
        </p>
        {onOpenSettings && (
          <Button
            onClick={onOpenSettings}
            className="bg-primary hover:bg-primary/90"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Plan
          </Button>
        )}
      </div>
    );
  }

  // Phase goal progress
  const phaseGoalProgress = getPhaseGoalProgress(builder);

  // Plan exists - show content
  return (
    <div className="flex flex-col">
      {/* Warnings */}
      {builder.warnings.length > 0 && (
        <div className="mb-4">
          <NutritionWarnings warnings={builder.warnings} />
        </div>
      )}

      {/* Header */}
      <NutritionPlanHeader
        weeklyTotal={builder.weeklyTotal}
        activePhase={builder.activePhase}
        onRegenerate={onOpenSettings}
      />

      {/* Metrics row */}
      <div className="flex items-center gap-6 mt-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Weekly Total</p>
          <p className="text-2xl font-semibold text-foreground">{builder.weeklyTotal.toLocaleString()} cal</p>
        </div>
        {phaseGoalProgress && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Phase Goal</p>
            <p className="text-2xl font-semibold text-foreground">{phaseGoalProgress}</p>
          </div>
        )}
      </div>

      {/* Roadmap goal line */}
      {builder.roadmapGoal?.longTermGoal && (
        <p className="text-sm text-muted-foreground mt-2">
          Roadmap goal: {builder.roadmapGoal.longTermGoal}
          {builder.roadmapGoal.targetEndDate &&
            ` by ${format(new Date(builder.roadmapGoal.targetEndDate), "MMM yyyy")}`}
        </p>
      )}

      {/* Day cards - always week view */}
      <div className="mt-6">
        {builder.weeklyTargets ? (
          <WeeklyNutritionView targets={builder.weeklyTargets} />
        ) : builder.nutritionData?.customMacrosEnabled ? (
          <CustomMacrosDisplay
            calories={builder.nutritionData?.calorieTarget || 0}
            protein={builder.nutritionData?.proteinTargetG || 0}
            carbs={builder.nutritionData?.carbTargetG || 0}
            fat={builder.nutritionData?.fatTargetG || 0}
          />
        ) : null}
      </div>
    </div>
  );
});

function getPhaseGoalProgress(builder: ReturnType<typeof useNutritionBuilderContext>): string | null {
  const { activePhase, client, unitPreference } = builder;

  if (activePhase?.phaseGoalWeight != null && client.currentWeight) {
    const currentKg = builder.weightToKg(client.currentWeight);
    const diffKg = Math.abs(currentKg - activePhase.phaseGoalWeight);
    const unit = unitPreference === "imperial" ? "lbs" : "kg";
    const value = unitPreference === "imperial"
      ? weightFromKg(diffKg, "lbs").toFixed(1)
      : diffKg.toFixed(1);
    return `${value} ${unit} to go`;
  }

  if (builder.weightRemaining) {
    const wr = builder.weightRemaining;
    return `${wr.isLoss ? "-" : "+"}${wr.value} ${wr.unit} to go`;
  }

  return null;
}

type CustomMacrosDisplayProps = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function CustomMacrosDisplay({ calories, protein, carbs, fat }: CustomMacrosDisplayProps) {
  return (
    <div className="bg-warning/5 rounded-lg p-8 text-center">
      <div className="text-4xl font-semibold text-warning">{calories.toLocaleString()}</div>
      <div className="text-sm text-muted-foreground mt-2">calories per day (custom macros)</div>
      <div className="grid grid-cols-3 gap-4 mt-6 pt-6">
        <div className="text-center bg-protein/10 rounded-lg p-4">
          <div className="text-2xl font-semibold text-protein">{protein}g</div>
          <div className="text-xs text-muted-foreground mt-1">Protein</div>
        </div>
        <div className="text-center bg-carbs/10 rounded-lg p-4">
          <div className="text-2xl font-semibold text-carbs">{carbs}g</div>
          <div className="text-xs text-muted-foreground mt-1">Carbs</div>
        </div>
        <div className="text-center bg-fat/10 rounded-lg p-4">
          <div className="text-2xl font-semibold text-fat">{fat}g</div>
          <div className="text-xs text-muted-foreground mt-1">Fat</div>
        </div>
      </div>
      <p className="text-xs text-fat mt-4 font-medium">Custom macros active - same targets each day</p>
    </div>
  );
}
