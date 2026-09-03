"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  MONO,
  MONO_LABEL_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionSettingsForm } from "./nutrition-settings-form";
import { NutritionTargetsBlock } from "./nutrition-targets-block";
import { NutritionSurplusSettings } from "./nutrition-surplus-settings";
import { NutritionGoalChangedBanner } from "../nutrition-goal-changed-banner";
import { useClientGoals } from "@/hooks/use-client-goals";
import { formatDateOnlyShort } from "@/components/clients/overview/overview-format";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import { getFirstName } from "@/lib/client-name";
import type { ClientGoal } from "@/types/client-goals";

function Divider() {
  return <div className="h-px bg-[rgba(13,148,136,0.08)]" />;
}

/**
 * READ-ONLY. The editor that used to sit here was the only goal editor in the
 * product, which meant setting a client's goal required opening a nutrition
 * plan; it now lives on the Overview status card, where the goal is displayed
 * (Task 0b.4). One writer, per invariant 16.
 *
 * **No link, deliberately.** The client page seeds its active tab from `?tab=`
 * as React state at mount, so an in-app `<Link>` would change the URL without
 * switching tabs, and a plain `<a>` would full-reload — discarding whatever
 * unsaved plan the coach has open in this very drawer. Threading a tab callback
 * down four components to avoid that is the prop-drilling §4 warns about. A
 * sentence naming the destination costs the coach one click and risks nothing.
 */
function GoalSummary({ goal }: { goal: ClientGoal | null }) {
  const { preference } = useUnits();

  const shown = goal?.goalWeight != null ? formatWeight(goal.goalWeight, preference) : null;
  const summary = shown
    ? `${shown.value.toFixed(1)} ${shown.unit}${
        goal?.goalDeadline ? ` by ${formatDateOnlyShort(goal.goalDeadline)}` : ""
      }`
    : null;

  return (
    <div className="space-y-1.5">
      <label className={SECTION_LABEL_CLASS}>Goal</label>
      {summary ? (
        // Standalone data, not a sentence — the numerals ARE the information.
        // The old summary printed the deadline as a raw ISO string.
        <p className={cn(MONO, "text-[13px] font-medium text-[#0c1a1e]")}>{summary}</p>
      ) : (
        <p className="text-[13px] font-medium text-[#0c1a1e]">No goal set</p>
      )}
      <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
        The long-term goal &amp; deadline drive nutrition pace. Set them on the
        client&apos;s Overview.
      </p>
    </div>
  );
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
  // The same shared read the Overview uses, so both surfaces render one goal
  // from one cache entry rather than two fetches that can disagree.
  const { goal } = useClientGoals(builder.client.id);
  // Both are required for the calculator to solve anything: without a deadline
  // it returns maintenance no matter what the target weight says.
  const hasGoalTarget = goal?.goalWeight != null && goal?.goalDeadline != null;

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-6" style={{ paddingBottom: 120 }}>
      <div className="space-y-5">
        <div className="space-y-4">
          <NutritionSettingsForm
            tdee={builder.client.tdee ?? null}
            proteinTargetGPerKg={builder.settings.proteinTargetGPerKg}
            dietType={builder.settings.dietType}
            onSettingsChange={builder.handleSettingsChange}
            effectiveFrom={builder.effectiveFrom}
            clientToday={builder.clientToday}
            queuedChangeDate={builder.nutritionData?.scheduledFor ?? null}
            onEffectiveFromChange={builder.handleEffectiveFromChange}
          />
          <NutritionGoalChangedBanner
            drift={builder.nutritionData?.goalChanged}
          />
          <GoalSummary goal={goal} />
        </div>

        <Divider />

        <NutritionTargetsBlock
          draft={builder.displayDraft}
          autoPlan={builder.autoPlan}
          autoTargets={builder.autoTargets}
          manualEnabled={builder.manualEnabled}
          onEnableManual={builder.enableManualTargets}
          onRevertToAuto={builder.revertToAuto}
          onFieldChange={builder.setManualField}
          macroTotal={builder.manualMacroTotal}
          caloriesMismatch={builder.manualCaloriesMismatch}
          onMatchMacros={builder.matchMacrosToCalories}
          missing={
            builder.calcInputs?.status === "incomplete" ? builder.calcInputs.missing : []
          }
          hasGoalTarget={hasGoalTarget}
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
          clientName={builder.client.name}
        />

        {/* Regeneration note — versioned model (migration 144): each save
            starts a new version from its chosen date; earlier days keep the
            numbers their own era prescribed. */}
        {builder.hasPlan && (
          <div className="bg-[rgba(245,158,11,0.07)] rounded-[6px] p-3.5 flex items-start gap-2.5">
            <Info className="w-3 h-3 text-[#d97706] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-[11.5px] font-medium text-[#d97706] leading-[1.4]">
              Saving starts a new version from the chosen date. Earlier days keep
              the numbers they had.
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
 *
 * THE HINT NAMES THE CONDITION, IT DOES NOT ASSERT THE OUTCOME. Since migration
 * 147 this note is client-visible, but it reaches the client's screen only
 * inside their CURRENT journey block — so it is invisible to a client with no
 * blocks, to one sitting between blocks, and again once the block it falls in
 * ends. "Shown to Sam" would therefore be false in three states, and a coach
 * who believes it writes an explanation that goes nowhere: precisely the
 * invisible, write-only note migration 139 dropped a column for. What IS
 * unconditionally true is that the client can see it, so that clause leads,
 * where the eye lands, and the location clause is qualified.
 */
function CollapsibleNotes({
  value,
  onChange,
  clientName,
}: {
  value: string;
  onChange: (value: string) => void;
  clientName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const firstName = getFirstName(clientName);

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
          <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
            {firstName ?? "Your client"} can see this &mdash; it shows on their
            Program tab with the block it falls in.
          </p>
          <Textarea
            autoFocus
            placeholder="Why are you adjusting this plan?"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="resize-none bg-white font-medium placeholder:font-normal"
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
