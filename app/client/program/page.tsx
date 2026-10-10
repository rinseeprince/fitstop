"use client";

import useSWR from "swr";

import { GoalCard } from "@/components/client-portal/program/goal-card";
import { NutritionPlanCard } from "@/components/client-portal/program/nutrition-plan-card";
import { TrainingPlanCard } from "@/components/client-portal/program/training-plan-card";
import { TrainingWeekLayout } from "@/components/client-portal/program/training-week-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProfile } from "@/hooks/use-client-profile";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientGoalWire } from "@/types/client-goal-wire";
import type { ClientTrainingPlan } from "@/types/client-training-plan";
import type { NutritionTargets } from "@/services/client-portal-service";

type TrainingPlanResponse = {
  success: boolean;
  data: ClientTrainingPlan | null;
};
type NutritionPlanResponse = {
  success: boolean;
  data: NutritionTargets | null;
};
type GoalResponse = {
  success: boolean;
  data: ClientGoalWire | null;
};

function ProgramSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-6">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-4 h-16 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function ProgramLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-destructive">We couldn&apos;t load your program.</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-primary underline"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyProgram() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-base font-semibold text-foreground">No program yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your coach hasn&apos;t set up your program. Check back soon.
      </p>
    </div>
  );
}

export default function ProgramPage() {
  // The newest readings the goal card's progress runs to. The layout renders
  // this page only once the profile has loaded, under the same key, so this
  // reads the cache.
  const { client } = useClientProfile();
  const {
    data: trainingPlanData,
    error: trainingPlanError,
    isLoading: trainingPlanLoading,
    mutate: mutateTrainingPlan,
  } = useSWR<TrainingPlanResponse>(
    "/api/client/training-plan",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  const {
    data: nutritionPlanData,
    error: nutritionPlanError,
    isLoading: nutritionPlanLoading,
    mutate: mutateNutritionPlan,
  } = useSWR<NutritionPlanResponse>(
    "/api/client/nutrition-plan",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  const {
    data: goalData,
    error: goalError,
    isLoading: goalLoading,
    mutate: mutateGoal,
  } = useSWR<GoalResponse>(
    "/api/client/goal",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  if (trainingPlanError && nutritionPlanError) {
    return (
      <ProgramLoadError
        onRetry={() => {
          void mutateTrainingPlan();
          void mutateNutritionPlan();
          void mutateGoal();
        }}
      />
    );
  }

  const loading =
    (trainingPlanLoading && !trainingPlanData) ||
    (nutritionPlanLoading && !nutritionPlanData) ||
    (goalLoading && !goalData);
  if (loading) return <ProgramSkeleton />;

  const trainingPlan = trainingPlanData?.data ?? null;
  const nutritionPlan = nutritionPlanData?.data ?? null;
  // A goal fetch failure only drops the goal card (the page's per-card error
  // posture); the plan cards below stay useful.
  const goal = !goalError ? (goalData?.data?.goal ?? null) : null;

  return (
    <div className="flex flex-col gap-2 pb-6">
      {goal && (
        <GoalCard
          goal={goal}
          current={{
            weightKg: client?.currentWeight ?? null,
            bodyFatPercentage: client?.currentBodyFatPercentage ?? null,
          }}
        />
      )}
      {!trainingPlan && !nutritionPlan ? (
        <EmptyProgram />
      ) : (
        <>
          {!trainingPlanError && trainingPlan && (
            <>
              <TrainingWeekLayout />
              <TrainingPlanCard plan={trainingPlan} />
            </>
          )}
          {!nutritionPlanError && nutritionPlan && <NutritionPlanCard />}
        </>
      )}
    </div>
  );
}
