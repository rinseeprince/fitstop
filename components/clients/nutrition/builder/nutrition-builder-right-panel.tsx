"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionWarnings } from "../nutrition-warnings";
import { NutritionPlanHero } from "../nutrition-plan-hero";
import { PageLoading } from "@/components/page-loading";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();

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
    </div>
  );
});
