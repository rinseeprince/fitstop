"use client";

import { useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionCustomMacrosSection } from "./nutrition-custom-macros-section";
import { NutritionTrainingCaloriesDisplay } from "./nutrition-training-calories-display";
import { NutritionRegenerationBanner } from "../nutrition-regeneration-banner";
import { UnitToggle } from "../../shared/unit-toggle";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertCircle } from "lucide-react";

type NutritionSettingsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NutritionSettingsDrawer({
  open,
  onOpenChange,
}: NutritionSettingsDrawerProps) {
  const builder = useNutritionBuilderContext();
  const wasGenerating = useRef(false);
  const previousPlanCreatedDate = useRef(builder.client.nutritionPlanCreatedDate);

  // Auto-close drawer on successful generation
  useEffect(() => {
    if (wasGenerating.current && !builder.isGenerating && builder.hasPlan) {
      // Only close if plan was created/changed
      if (builder.client.nutritionPlanCreatedDate !== previousPlanCreatedDate.current) {
        onOpenChange(false);
      }
    }
    wasGenerating.current = builder.isGenerating;
    previousPlanCreatedDate.current = builder.client.nutritionPlanCreatedDate;
  }, [builder.isGenerating, builder.hasPlan, builder.client.nutritionPlanCreatedDate, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!inset-y-auto !h-auto !right-4 !top-4 !bottom-4 max-h-[calc(100vh-2rem)] w-[420px] rounded-2xl border-0 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25),0_12px_24px_-8px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.05)] p-5 flex flex-col bg-gradient-to-b from-white to-gray-50/30"
      >
        <SheetHeader className="pb-4 border-b border-gray-100 px-0">
          <SheetTitle className="text-lg font-semibold">
            {builder.hasPlan ? "Regenerate Nutrition Plan" : "Generate Nutrition Plan"}
          </SheetTitle>
        </SheetHeader>

        <div className="pt-5 flex-1 overflow-y-auto px-0.5 space-y-5">
          {/* Unit Toggle */}
          <UnitToggle
            value={builder.unitPreference}
            onChange={builder.handleUnitChange}
            disabled={builder.isSavingUnit}
          />

          {/* Regeneration Banner */}
          {builder.client.currentWeight && builder.client.nutritionPlanBaseWeightKg && (
            <NutritionRegenerationBanner
              currentWeight={builder.client.currentWeight}
              weightUnit={builder.client.weightUnit || "lbs"}
              nutritionPlanBaseWeightKg={builder.client.nutritionPlanBaseWeightKg}
              nutritionPlanCreatedDate={builder.client.nutritionPlanCreatedDate}
              unitPreference={builder.unitPreference}
              onRegenerate={() => builder.generatePlan(false)}
              showRegenerateButton={false}
            />
          )}

          {/* Settings Form */}
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
            includeActivityBurn={builder.includeActivityBurn}
            onToggleActivityBurn={builder.handleToggleActivityBurn}
            isSavingToggle={builder.isSavingBurnToggle}
          />
        </div>

        {/* Generate Button */}
        <div className="pt-4 border-t border-gray-100 mt-4">
          <Button
            onClick={() => builder.generatePlan(false)}
            disabled={builder.isGenerating}
            className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-primary-foreground font-medium px-4 py-2.5 rounded-lg shadow-sm hover:shadow transition-all"
          >
            <Sparkles className={`h-4 w-4 mr-2 ${builder.isGenerating ? "animate-pulse" : ""}`} />
            {builder.isGenerating
              ? "Generating..."
              : builder.settingsChanged
                ? "Save & Regenerate Plan"
                : builder.hasPlan
                  ? "Regenerate Plan"
                  : "Generate Plan"}
          </Button>

          {!builder.client.bmr && (
            <div className="bg-primary/10 rounded-xl p-4 mt-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">BMR not calculated</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Calculate BMR first using the button in the Profile tab.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
