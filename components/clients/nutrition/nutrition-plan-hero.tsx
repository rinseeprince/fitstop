"use client";

import { cn } from "@/lib/utils";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { HEADER_EYEBROW_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { InlineMono } from "@/components/clients/overview/overview-primitives";
import {
  formatDateOnlyShort,
  formatDateOnlyWeekday,
} from "@/components/clients/overview/overview-format";

type NutritionPlanHeroProps = {
  /** The teal primary renders only when provided (regenerate / generate). */
  onOpenSettings?: () => void;
};

// The Plans-subtab hero, in the same anatomy as the training tab's
// TrainingPlanHero: eyebrow + title cluster on top, actions in the bottom row
// under a hairline. No stat row — the Data tab's summary strip owns week
// numbers, and the strip that used to sit here derived a weekly total from a
// weekday template that moved week to week as training events changed.
//
// The title is the client's TRAINING program, not the nutrition plan:
// `nutrition_plans.name` is never written, so the program is the only name
// available, and it answers the same "which block is this client in" question a
// phase name will answer once phases ship. Owns the empty branch too, so the
// right panel has a single hero mount.
export function NutritionPlanHero({ onOpenSettings }: NutritionPlanHeroProps) {
  const { hasPlan, trainingPlanName, nutritionData } = useNutritionBuilderContext();

  const effectiveFrom = nutritionData?.effectiveFrom ?? null;
  // A plan whose window opens later is queued, not running. The server owns that
  // comparison (see the route) — same wording and formatter as the training
  // hero's queued line.
  const scheduledFor = nutritionData?.scheduledFor ?? null;

  // Title ladder. A client can carry nutrition without training, and then there
  // is no program to name — fall back to the plan's own identity (its start
  // date) rather than announcing a missing training plan under a "Nutrition
  // plan" eyebrow.
  let title: string;
  if (!hasPlan) {
    title = "No active nutrition plan";
  } else if (trainingPlanName) {
    title = trainingPlanName;
  } else if (effectiveFrom && !scheduledFor) {
    title = `Active since ${formatDateOnlyShort(effectiveFrom)}`;
  } else {
    title = "Active plan";
  }

  return (
    <div className="rounded-[6px] bg-[#0f2027] px-5 py-[18px]">
      <div className="min-w-0">
        <p className={HEADER_EYEBROW_CLASS}>Nutrition plan</p>
        <h2
          className={cn(
            "mt-0.5 truncate text-[15px] font-medium",
            hasPlan ? "text-white" : "text-[rgba(255,255,255,0.4)]",
          )}
        >
          {title}
        </h2>
        {/* No space before InlineMono — it owns its own gap. */}
        {hasPlan && scheduledFor && (
          <p className="mt-1 text-[11px] font-medium text-[rgba(255,255,255,0.45)]">
            Starts<InlineMono>{formatDateOnlyWeekday(scheduledFor)}</InlineMono>
          </p>
        )}
      </div>

      {/* Action row — the hero's "underneath" slot, in the lens-row register:
          primary action = the active-chip teal. Text-only, no icons. Delete
          stays on the calendar rail, destructive-rightmost. */}
      <div className="mt-3 flex items-center gap-1 border-t border-[rgba(255,255,255,0.06)] pt-3">
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="rounded-[4px] bg-[rgba(13,148,136,0.15)] px-2 py-1 text-[11px] font-medium text-[#0d9488] transition-colors"
          >
            {hasPlan ? "Regenerate plan" : "Generate plan"}
          </button>
        )}
      </div>
    </div>
  );
}
