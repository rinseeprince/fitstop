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
import { CalorieSkewingSection } from "./calorie-skewing-section";
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
        className="!inset-y-auto !h-auto !right-4 !top-4 !bottom-4 max-h-[calc(100vh-2rem)] w-[420px] rounded-lg border-0 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25),0_12px_24px_-8px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.05)] p-5 flex flex-col bg-card"
      >
        <SheetHeader className="pb-4 border-b border-border px-0">
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

          {/* Calorie Skewing */}
          <CalorieSkewingSection
            enabled={builder.customDayDistribution}
            onToggle={builder.handleToggleCustomDistribution}
            dayOverrides={builder.dayCalorieOverrides}
            onDayChange={builder.handleDayOverrideChange}
            weeklyTargets={builder.weeklyTargets}
            budgetValidation={builder.budgetValidation}
            macroMode={builder.skewMacroMode}
            onMacroModeChange={builder.setSkewMacroMode}
            onReset={builder.handleResetToDefault}
            onSave={builder.handleSaveCustomDistribution}
            isSaving={builder.isSavingSkew}
            hasPlan={builder.hasPlan}
          />
        </div>

        {/* Generate Button */}
        <div className="pt-4 border-t border-border mt-4">
          {builder.customDayDistribution && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg mb-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">
                Regenerating will reset custom day distribution. You can re-enable it after.
              </p>
            </div>
          )}
          <Button
            onClick={() => builder.generatePlan(false)}
            disabled={builder.isGenerating || (builder.customDayDistribution && !builder.budgetValidation?.isValid)}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-4 py-2.5 rounded-lg transition-all"
            title={
              builder.customDayDistribution && !builder.budgetValidation?.isValid
                ? "Save your custom day distribution first, or adjust calories to match the weekly budget"
                : undefined
            }
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
            <div className="bg-primary/10 rounded-lg p-4 mt-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">BMR not calculated</p>
                  <p className="text-sm text-muted-foreground mt-1">
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
