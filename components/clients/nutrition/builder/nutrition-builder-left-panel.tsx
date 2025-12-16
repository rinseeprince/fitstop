"use client";

import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionCustomMacrosSection } from "./nutrition-custom-macros-section";
import { NutritionTrainingCaloriesDisplay } from "./nutrition-training-calories-display";
import { NutritionRegenerationBanner } from "../nutrition-regeneration-banner";
import { UnitToggle } from "../../shared/unit-toggle";
import { Button } from "@/components/ui/button";
import { RefreshCw, Settings2 } from "lucide-react";

export function NutritionBuilderLeftPanel() {
  const builder = useNutritionBuilderContext();

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header with Unit Toggle */}
      <div className="flex items-center justify-between pb-3 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Current Settings
        </h3>
        <UnitToggle
          value={builder.unitPreference}
          onChange={builder.handleUnitChange}
          disabled={builder.isSavingUnit}
        />
      </div>

      {/* Regeneration Banner */}
      {builder.client.currentWeight && builder.client.nutritionPlanBaseWeightKg && (
        <NutritionRegenerationBanner
          currentWeight={builder.client.currentWeight}
          weightUnit={builder.client.weightUnit || "lbs"}
          nutritionPlanBaseWeightKg={builder.client.nutritionPlanBaseWeightKg}
          nutritionPlanCreatedDate={builder.client.nutritionPlanCreatedDate}
          unitPreference={builder.unitPreference}
          onRegenerate={() => builder.generatePlan(false)}
          showRegenerateButton={!builder.isGenerating}
        />
      )}

      {/* Settings Form */}
      <div className="flex-1 overflow-y-auto space-y-4">
        <NutritionSettingsForm
          client={builder.client}
          onSettingsChange={builder.handleSettingsChange}
        />

        {/* Custom Macros Section */}
        <NutritionCustomMacrosSection
          customMacros={builder.customMacros}
          setCustomMacros={builder.setCustomMacros}
          validationError={builder.customMacrosValidationError}
          showCustomMacros={builder.showCustomMacros}
          setShowCustomMacros={builder.setShowCustomMacros}
          onSaveCustom={() => builder.generatePlan(true)}
          isGenerating={builder.isGenerating}
        />

        {/* Training Calories Display */}
        <NutritionTrainingCaloriesDisplay
          trainingPlan={builder.trainingPlan}
          isLoading={builder.isLoadingTrainingPlan}
          dailyCalories={builder.dailyTrainingCalories}
          weeklyCalories={builder.weeklyTrainingCalories}
          caloriesByDay={builder.trainingCaloriesByDay}
        />
      </div>

      {/* Generate Button */}
      <div className="pt-4 border-t">
        <Button
          onClick={() => builder.generatePlan(false)}
          disabled={builder.isGenerating}
          className="w-full"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${builder.isGenerating ? "animate-spin" : ""}`} />
          {builder.settingsChanged
            ? "Save & Regenerate Plan"
            : builder.hasPlan
              ? "Regenerate Plan"
              : "Generate Plan"}
        </Button>

        {!builder.client.bmr && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 mt-3">
            <p className="font-medium">BMR not calculated</p>
            <p className="text-blue-800 mt-1">
              Calculate BMR first using the button in the Profile tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
