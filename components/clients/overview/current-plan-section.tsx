"use client";

import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanTrainingCard } from "./plan-training-card";
import { PlanNutritionCard } from "./plan-nutrition-card";
import { nutritionDrawerParams, type ClientTab } from "@/lib/client-tabs";
import type { OverviewPlanSummary } from "@/types/coach-overview";

type CurrentPlanSectionProps = {
  clientId: string;
  summary: OverviewPlanSummary | null;
  isLoading: boolean;
  onTabChange: (tab: ClientTab, extraParams?: Record<string, string>) => void;
};

export function CurrentPlanSection({
  clientId,
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
          <PlanTrainingCard
            training={training}
            upcomingTraining={summary?.upcomingTraining ?? null}
            onOpenTraining={() => onTabChange("training")}
          />
          <PlanNutritionCard
            clientId={clientId}
            nutrition={summary?.nutrition ?? null}
            upcomingNutrition={summary?.upcomingNutrition ?? null}
            onOpenNutrition={() => onTabChange("nutrition")}
            // One navigation: the tab, the Plans pane and the drawer — on the
            // notice's day when it names one (docs/MEASUREMENT-LOG-PLAN.md 8d1).
            onOpenNutritionDrawer={(startsOn) =>
              onTabChange("nutrition", nutritionDrawerParams(startsOn))
            }
          />
        </div>
      )}
    </div>
  );
}
