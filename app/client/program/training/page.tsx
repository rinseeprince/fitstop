"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TrainingSessionRow } from "@/components/client-portal/program/training-session-row";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientTrainingPlan } from "@/types/client-training-plan";

type TrainingPlanResponse = {
  success: boolean;
  data: ClientTrainingPlan | null;
};

function TrainingPlanSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-6">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-4 h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

function TrainingPlanLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-destructive">
        We couldn&apos;t load your training plan.
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

function EmptyTrainingPlan() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-base font-semibold text-foreground">
        No training plan yet
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your coach hasn&apos;t set up your training plan. Check back soon.
      </p>
    </div>
  );
}

export default function ProgramTrainingPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<TrainingPlanResponse>(
    "/api/client/training-plan",
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
        <TrainingPlanLoadError onRetry={() => mutate()} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <TrainingPlanSkeleton />
      </div>
    );
  }

  const plan = data.data;
  if (!plan) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <EmptyTrainingPlan />
      </div>
    );
  }

  const sortedSessions = [...plan.sessions].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );

  return (
    <div>
      <div className="mb-3">{backLink}</div>
      <h1 className="text-base font-semibold text-foreground">
        {plan.planName}
      </h1>
      <div className="mt-4 flex flex-col gap-2 pb-6">
        {sortedSessions.map((session) => (
          <TrainingSessionRow key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}
