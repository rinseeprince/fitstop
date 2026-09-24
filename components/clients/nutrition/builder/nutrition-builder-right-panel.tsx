"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionPlanHero } from "../nutrition-plan-hero";
import { NutritionOutOfDateNotice } from "../nutrition-out-of-date-notice";
import { PageLoading } from "@/components/page-loading";
import { useCloseNutritionOutOfDate, useNutritionOutOfDate } from "@/hooks/use-nutrition-goal";

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
  const closeOutOfDate = useCloseNutritionOutOfDate();

  // Loading state for training plan or nutrition data
  // KNOWN GAP: this panel has loading and content states only. The context
  // exposes the plan read's failure (`isNutritionError`), which the drawer
  // shows with Try again; this panel has no error branch yet (docs rule: every
  // fetch-backed surface has one).
  if (builder.isLoadingTrainingPlan || builder.isLoadingNutrition) {
    return <PageLoading label="Loading nutrition plan…" />;
  }

  // The hero owns both branches (plan / no plan), so there is a single hero
  // mount here — the training tab's pattern.
  return (
    <div className="flex flex-col gap-4">
      <NutritionPlanHero onOpenSettings={onOpenSettings} />

      {outOfDate && clientToday && (
        <NutritionOutOfDateNotice
          outOfDate={outOfDate}
          clientToday={clientToday}
          // Today's problem: Starts on back to today — never a day an earlier,
          // unsaved pick left in the drawer — then the drawer opens on it.
          onRegenerate={() => {
            builder.setStartsOn(clientToday);
            onOpenSettings?.();
          }}
          // The date and the drawer in one click: Starts on moves to the
          // notice's day, then the drawer opens on it.
          onSetFrom={(day) => {
            builder.setStartsOn(day);
            onOpenSettings?.();
          }}
          onClose={() => void closeOutOfDate(builder.client.id, outOfDate)}
        />
      )}
    </div>
  );
});
