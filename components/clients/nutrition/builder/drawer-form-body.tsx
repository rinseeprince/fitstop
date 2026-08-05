"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
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

        <CollapsibleNotes
          value={builder.coachNotes}
          onChange={(v) => builder.setCoachNotes(v.slice(0, 500))}
        />

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

/**
 * Notes, collapsed by default.
 *
 * It opens empty every time — it describes THIS change, not the plan — so it
 * does not deserve permanent vertical space in a 420px drawer above the pickers
 * and targets a coach actually came here for.
 *
 * Hand-rolled rather than components/ui/collapsible: all three usages of that
 * primitive are client-facing, and the established coach pattern is an
 * `expanded &&` body behind a chevron button (program-builder/exercise-card).
 */
function CollapsibleNotes({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          FOCUS_RING,
          "flex w-full items-center gap-1.5 rounded-[4px] py-0.5 text-left transition-colors"
        )}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-[#93b0b4] transition-transform duration-200",
            !expanded && "-rotate-90"
          )}
          strokeWidth={1.5}
        />
        <span className={SECTION_LABEL_CLASS}>Notes</span>
        {/* Collapsed with content typed: say so, or the coach cannot tell the
            note is still attached to the regenerate they are about to run. */}
        {!expanded && value.trim() !== "" && (
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#0d9488]" />
        )}
        <span className="ml-auto text-[10px] text-[#93b0b4]">Optional</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-[rgba(13,148,136,0.08)] pt-2.5">
          <Textarea
            autoFocus
            placeholder="Why are you adjusting this plan?"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="resize-none bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] placeholder:text-[#93b0b4] placeholder:font-normal focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all"
            rows={3}
          />
          <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal text-right")}>
            {value.length}/500
          </p>
        </div>
      )}
    </div>
  );
}
