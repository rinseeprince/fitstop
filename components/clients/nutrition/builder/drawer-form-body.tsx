"use client";

import { Textarea } from "@/components/ui/textarea";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MONO_LABEL_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionTargetsBlock } from "./nutrition-targets-block";
import { NutritionSurplusSettings } from "./nutrition-surplus-settings";
import { ClientGoalEditor } from "../../client-goal-editor";
import { NutritionGoalChangedBanner } from "../nutrition-goal-changed-banner";

function Divider() {
  return <div className="h-px bg-[rgba(13,148,136,0.08)]" />;
}

/**
 * ONE surface, not a tab pair.
 *
 * The pickers are always visible, the targets they produce are always visible,
 * and "Edit manually" inside the targets block hands the numbers over without
 * hiding the controls that generated them. The old Auto/Custom tabs posted to
 * the same endpoint and differed by a single boolean, so the split bought
 * nothing and cost the coach the ability to see a cause and its effect at once.
 */
export function DrawerFormBody() {
  const builder = useNutritionBuilderContext();

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-6" style={{ paddingBottom: 120 }}>
      <div className="space-y-5">
        <div className="space-y-4">
          <NutritionSettingsForm
            client={builder.client}
            workActivityLevel={builder.settings.workActivityLevel}
            proteinTargetGPerKg={builder.settings.proteinTargetGPerKg}
            dietType={builder.settings.dietType}
            onSettingsChange={builder.handleSettingsChange}
          />
          <NutritionGoalChangedBanner
            drift={builder.nutritionData?.goalChanged}
            unitPreference={builder.unitPreference}
          />
          {/* Editing the goal here invalidates the calorie preview and the
              drift banner above it, and this editor only revalidates its own
              SWR key — so it has to tell the drawer to re-resolve. */}
          <ClientGoalEditor
            clientId={builder.client.id}
            unit={builder.client.weightUnit || "lbs"}
            onSaved={builder.refetchNutrition}
          />
        </div>

        <Divider />

        <NutritionTargetsBlock
          targets={builder.displayTargets}
          autoPlan={builder.autoPlan}
          autoTargets={builder.autoTargets}
          manualEnabled={builder.manualEnabled}
          onEnableManual={builder.enableManualTargets}
          onRevertToAuto={builder.revertToAuto}
          onCaloriesChange={builder.setManualCalories}
          onMacroChange={builder.setManualMacro}
          manualValidationError={builder.manualValidationError}
          missing={
            builder.calcInputs?.status === "incomplete" ? builder.calcInputs.missing : []
          }
        />

        <Divider />

        <NutritionSurplusSettings
          hasTrainingPlan={builder.hasTrainingPlan}
          isLoading={builder.isLoadingTrainingPlan}
          includeActivityBurn={builder.includeActivityBurn}
          onToggleActivityBurn={builder.handleToggleActivityBurn}
          isSavingToggle={builder.isSavingBurnToggle}
          surplusAsCarbs={builder.surplusAsCarbs}
          onToggleSurplusAsCarbs={builder.handleToggleSurplusAsCarbs}
          isSavingSurplus={builder.isSavingSurplusToggle}
        />

        <Divider />

        {/* Notes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={SECTION_LABEL_CLASS}>Notes</label>
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
    </div>
  );
}
