"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { VerticalNutritionView } from "@/components/client-portal/nutrition/vertical-nutrition-view";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { NutritionTargets } from "@/services/client-portal-service";

type NutritionPlanResponse = {
  success: boolean;
  data: NutritionTargets | null;
};

function NutritionPlanSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-6">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-4 h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function NutritionPlanLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-destructive">
        We couldn&apos;t load your nutrition plan.
      </p>
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

function EmptyNutritionPlan() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-base font-semibold text-foreground">
        No nutrition plan yet
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your coach hasn&apos;t set up your nutrition plan. Check back soon.
      </p>
    </div>
  );
}

export default function ProgramNutritionPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<NutritionPlanResponse>(
    "/api/client/nutrition-plan",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  const handleBack = () => {
    const sameOriginReferrer =
      typeof document !== "undefined" &&
      document.referrer !== "" &&
      document.referrer.startsWith(window.location.origin);
    if (sameOriginReferrer) {
      router.back();
    } else {
      router.push("/client/program");
    }
  };

  const backLink = (
    <button
      type="button"
      onClick={handleBack}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Program
    </button>
  );

  if (error) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <NutritionPlanLoadError onRetry={() => mutate()} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <NutritionPlanSkeleton />
      </div>
    );
  }

  const targets = data.data;
  if (!targets) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <EmptyNutritionPlan />
      </div>
    );
  }

  const dailyTargets = targets.dailyTargets ?? [];
  const hasDailyTargets = dailyTargets.length > 0;

  return (
    <div>
      <div className="mb-3">{backLink}</div>
      <h1 className="text-base font-semibold text-foreground">
        Nutrition plan
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {targets.dietType && (
          <Badge variant="secondary" className="capitalize">
            {targets.dietType.replace(/_/g, " ")} diet
          </Badge>
        )}
        {targets.customMacrosEnabled && (
          <Badge variant="outline">Custom macros</Badge>
        )}
      </div>
      <div className="mt-6 pb-6">
        {hasDailyTargets ? (
          <VerticalNutritionView targets={dailyTargets} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No daily targets configured for this plan yet.
          </p>
        )}
      </div>
    </div>
  );
}
