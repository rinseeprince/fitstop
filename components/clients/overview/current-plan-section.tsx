"use client";

import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanTrainingCard } from "./plan-training-card";
import { PlanNutritionCard } from "./plan-nutrition-card";
import type { ClientTab } from "@/lib/client-tabs";
import type { OverviewPlanSummary } from "@/types/coach-overview";

type CurrentPlanSectionProps = {
  summary: OverviewPlanSummary | null;
  isLoading: boolean;
  onTabChange: (tab: ClientTab) => void;
};

export function CurrentPlanSection({
  summary,
  isLoading,
  onTabChange,
}: CurrentPlanSectionProps) {
  const training = summary?.training ?? null;
  const weekMeta =
    training && training.currentWeek !== null && training.programDurationWeeks !== null
      ? `Week ${training.currentWeek} of ${training.programDurationWeeks}`
      : undefined;

  return (
    <div>
      <SectionLabel label="Current plan" meta={weekMeta} />
      {isLoading && !summary ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[186px] rounded-[6px]" />
          <Skeleton className="h-[186px] rounded-[6px]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PlanTrainingCard training={training} onOpenTraining={() => onTabChange("training")} />
          <PlanNutritionCard
            nutrition={summary?.nutrition ?? null}
            onOpenNutrition={() => onTabChange("nutrition")}
          />
        </div>
      )}
    </div>
  );
}
