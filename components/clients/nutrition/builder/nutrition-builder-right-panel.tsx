"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionWarnings } from "../nutrition-warnings";
import { NutritionPlanHero } from "../nutrition-plan-hero";
import { NutritionOutOfDateNotice } from "../nutrition-out-of-date-notice";
import { PageLoading } from "@/components/page-loading";
import { useNutritionOutOfDate } from "@/hooks/use-nutrition-goal";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();
  // Whether the saved versions still fit the goal — the one rule, shown under
  // the hero (docs/MEASUREMENT-LOG-PLAN.md commit 8d1). Read beside the plan
  // read, never behind it, so it lands with the pane.
  const { outOfDate, clientToday } = useNutritionOutOfDate(builder.client.id);

  // Loading state for training plan or nutrition data
  // KNOWN GAP: the nutrition builder context exposes no load error, so this
  // panel has loading and content states only — the error branch needs the
  // context to surface one first (docs rule: every fetch-backed surface has
  // an error branch).
  if (builder.isLoadingTrainingPlan || builder.isLoadingNutrition) {
    return <PageLoading label="Loading nutrition plan…" />;
  }

  // The hero owns both branches (plan / no plan), so there is a single hero
  // mount here — the training tab's pattern.
  return (
    <div className="flex flex-col gap-4">
      {builder.warnings.length > 0 && (
        <NutritionWarnings warnings={builder.warnings} />
      )}

      <NutritionPlanHero onOpenSettings={onOpenSettings} />

      {outOfDate && clientToday && (
        <NutritionOutOfDateNotice
          outOfDate={outOfDate}
          clientToday={clientToday}
          onRegenerate={onOpenSettings}
          // The date and the drawer in one click: Starts on moves to the
          // notice's day, then the drawer opens on it.
          onSetFrom={(day) => {
            builder.setStartsOn(day);
            onOpenSettings?.();
          }}
        />
      )}
    </div>
  );
});
