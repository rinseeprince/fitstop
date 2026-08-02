"use client";

import { Textarea } from "@/components/ui/textarea";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MONO_LABEL_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionCustomMacrosSection } from "./nutrition-custom-macros-section";
import { NutritionTrainingCaloriesDisplay } from "./nutrition-training-calories-display";
import { CalorieSkewingSection } from "./calorie-skewing-section";
import { ClientGoalEditor } from "../../client-goal-editor";
import { NutritionGoalChangedBanner } from "../nutrition-goal-changed-banner";

function Divider() {
  return <div className="h-px bg-[rgba(13,148,136,0.08)]" />;
}

export function DrawerFormBody() {
  const builder = useNutritionBuilderContext();

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-6" style={{ paddingBottom: 120 }}>
      <Tabs
        value={builder.generationMode}
        onValueChange={(v) => builder.setGenerationMode(v === "custom" ? "custom" : "auto")}
      >
        <TabsList className="mb-5">
          <TabsTrigger value="auto">Auto generation</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>

        {/* Auto: calculate macros from settings + goal context */}
        <TabsContent value="auto" className="space-y-5">
          <div className="space-y-4">
            <NutritionSettingsForm
              client={builder.client}
              onSettingsChange={builder.handleSettingsChange}
            />
            <NutritionGoalChangedBanner
              drift={builder.nutritionData?.goalChanged}
              unitPreference={builder.unitPreference}
            />
            <ClientGoalEditor
              clientId={builder.client.id}
              unit={builder.client.weightUnit || "lbs"}
            />
          </div>
          <Divider />
          <SharedControls />
        </TabsContent>

        {/* Custom: total calories + P/C/F % split (stored as grams) */}
        <TabsContent value="custom" className="space-y-5">
          <NutritionCustomMacrosSection
            calories={builder.customCalories}
            onCaloriesChange={builder.setCustomCalories}
            proteinPct={builder.customProteinPct}
            onProteinPctChange={builder.setCustomProteinPct}
            carbPct={builder.customCarbPct}
            onCarbPctChange={builder.setCustomCarbPct}
            fatPct={builder.customFatPct}
            onFatPctChange={builder.setCustomFatPct}
            grams={builder.customGrams}
            reTotaledCalories={builder.customReTotaledCalories}
            validationError={builder.customMacrosValidationError}
          />
          <Divider />
          <SharedControls />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Shared between Auto and Custom: the activity-burn toggle, calorie-skewing, and
 * notes. Burn STACKS in Custom too (display-time on the event surplus — these are
 * the same controls, no special handling).
 */
function SharedControls() {
  const builder = useNutritionBuilderContext();

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <NutritionTrainingCaloriesDisplay
          hasTrainingPlan={builder.hasTrainingPlan}
          isLoading={builder.isLoadingTrainingPlan}
          dailyCalories={builder.dailyTrainingCalories}
          weeklyCalories={builder.weeklyTrainingCalories}
          caloriesByDay={builder.trainingCaloriesByDay}
          includeActivityBurn={builder.includeActivityBurn}
          onToggleActivityBurn={builder.handleToggleActivityBurn}
          isSavingToggle={builder.isSavingBurnToggle}
          surplusAsCarbs={builder.surplusAsCarbs}
          onToggleSurplusAsCarbs={builder.handleToggleSurplusAsCarbs}
          isSavingSurplus={builder.isSavingSurplusToggle}
        />
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
          hasPlan={builder.hasPlan}
        />
      </div>

      <Divider />

      {/* Notes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={SECTION_LABEL_CLASS}>
            Notes
          </label>
          <span className="text-[10px] text-[#93b0b4]">Optional</span>
        </div>
        <Textarea
          placeholder="Why are you adjusting this plan?"
          value={builder.coachNotes}
          onChange={(e) => builder.setCoachNotes(e.target.value.slice(0, 500))}
          className="resize-none bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] placeholder:text-[#93b0b4] placeholder:font-normal focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all"
          rows={3}
        />
        <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal text-right")}>
          {builder.coachNotes.length}/500
        </p>
      </div>

      {/* Regeneration note — in-place replacement, no versioning/Plan History. */}
      {builder.hasPlan && (
        <div className="bg-[rgba(245,158,11,0.07)] rounded-[6px] p-3.5 flex items-start gap-2.5">
          <Info className="w-3 h-3 text-[#d97706] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
          <p className="text-[11.5px] font-medium text-[#d97706] leading-[1.4]">
            Regenerating replaces the targets from the effective date forward. Past
            and logged days are unchanged.
          </p>
        </div>
      )}
    </div>
  );
}
