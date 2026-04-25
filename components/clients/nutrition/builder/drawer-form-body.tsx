"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Info } from "lucide-react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionCustomMacrosSection } from "./nutrition-custom-macros-section";
import { NutritionTrainingCaloriesDisplay } from "./nutrition-training-calories-display";
import { CalorieSkewingSection } from "./calorie-skewing-section";
import { UnitToggle } from "../../shared/unit-toggle";
import { PhaseSelector } from "../../shared/phase-selector";
import { getTodayDateString } from "@/lib/date-helpers";

function Divider() {
  return <div className="h-px bg-[rgba(13,148,136,0.08)]" />;
}

function AnimatedGroup({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="animate-drawer-fade-up"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      {children}
    </div>
  );
}

export function DrawerFormBody() {
  const builder = useNutritionBuilderContext();

  return (
    <div
      className="flex-1 overflow-y-auto px-6 pt-6"
      style={{ paddingBottom: 120 }}
    >
      <div className="space-y-5">
        {/* Group 1: Unit System */}
        <AnimatedGroup index={0}>
          <UnitToggle
            value={builder.unitPreference}
            onChange={builder.handleUnitChange}
            disabled={builder.isSavingUnit}
          />
        </AnimatedGroup>

        <Divider />

        {/* Group 2: Macro Parameters + Plan Context */}
        <AnimatedGroup index={1}>
          <div className="space-y-4">
            <NutritionSettingsForm
              client={builder.client}
              onSettingsChange={builder.handleSettingsChange}
            />

            {/* Roadmap Phase */}
            <PhaseSelector
              clientId={builder.client.id}
              weightUnit={builder.client.weightUnit || "lbs"}
              value={builder.phaseId}
              onChange={builder.setPhaseId}
              onBlockSubmit={builder.setPhaseBlocked}
              phases={builder.phases}
              activeOnly
            />

            {/* Goal Deadline */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">
                  Goal Deadline
                </label>
                <span className="text-[10px] text-[#93b0b4]">Optional</span>
              </div>
              <Input
                id="goal-deadline"
                type="date"
                value={builder.settings.goalDeadline}
                onChange={(e) => builder.handleSettingsChange({ goalDeadline: e.target.value })}
                min={getTodayDateString()}
                placeholder="dd / mm / yyyy"
                className="w-full px-3.5 py-2.5 bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 focus:outline-none transition-all"
              />
              <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
                Target date to reach goal weight (affects calorie deficit/surplus)
              </p>
            </div>
          </div>
        </AnimatedGroup>

        {/* Custom Macros (collapsible, below macro params) */}
        <AnimatedGroup index={3}>
          <NutritionCustomMacrosSection
            customMacros={builder.customMacros}
            setCustomMacros={builder.setCustomMacros}
            validationError={builder.customMacrosValidationError}
            showCustomMacros={builder.showCustomMacros}
            setShowCustomMacros={builder.setShowCustomMacros}
            onSaveCustom={() => builder.generatePlan(true)}
            isGenerating={builder.isGenerating}
          />
        </AnimatedGroup>

        <Divider />

        {/* Group 4: Toggles */}
        <AnimatedGroup index={4}>
          <div className="space-y-4">
            {/* Activity burn toggle + training calories detail */}
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

            {/* Custom day distribution toggle + skewing detail */}
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
        </AnimatedGroup>

        <Divider />

        {/* Group 5: Notes */}
        <AnimatedGroup index={5}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">
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
            <p className="text-right font-mono-display text-[10px] text-[#93b0b4]">
              {builder.coachNotes.length}/500
            </p>
          </div>
        </AnimatedGroup>

        {/* Warning callout */}
        <AnimatedGroup index={6}>
          <div className="bg-[rgba(245,158,11,0.07)] rounded-[6px] p-3.5 flex items-start gap-2.5">
            <Info className="w-3 h-3 text-[#d97706] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-[11.5px] font-medium text-[#d97706] leading-[1.4]">
              This will archive the current plan and create a new active revision in Plan History.
            </p>
          </div>
        </AnimatedGroup>
      </div>
    </div>
  );
}
