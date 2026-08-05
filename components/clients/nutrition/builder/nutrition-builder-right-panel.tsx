"use client";

import { memo } from "react";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionWarnings } from "../nutrition-warnings";
import { NutritionPlanHero } from "../nutrition-plan-hero";
import { Loader2 } from "lucide-react";

type NutritionBuilderRightPanelProps = {
  onOpenSettings?: () => void;
};

export const NutritionBuilderRightPanel = memo(function NutritionBuilderRightPanel({
  onOpenSettings,
}: NutritionBuilderRightPanelProps) {
  const builder = useNutritionBuilderContext();

  // Loading state for training plan or nutrition data
  if (builder.isLoadingTrainingPlan || builder.isLoadingNutrition) {
    return (
      <div className="flex items-center justify-center h-full bg-white/50 rounded-[6px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#93b0b4]" />
      </div>
    );
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
