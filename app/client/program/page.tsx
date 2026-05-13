"use client";

import useSWR from "swr";

import { PhaseListItem } from "@/components/client-portal/program/phase-list-item";
import { RoadmapSummaryStrip } from "@/components/client-portal/program/roadmap-summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientProgram } from "@/types/client-program";

type ProgramResponse = { success: boolean; data: ClientProgram | null };

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

function EmptyRoadmap() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-base font-semibold text-foreground">No roadmap yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your coach hasn&apos;t set up your program roadmap. Check back soon.
      </p>
    </div>
  );
}

export default function ProgramPage() {
  const { data, error, isLoading, mutate } = useSWR<ProgramResponse>(
    "/api/client/program",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  if (error) return <ProgramLoadError onRetry={() => mutate()} />;
  if (isLoading || !data) return <ProgramSkeleton />;

  const program = data.data;
  if (!program) return <EmptyRoadmap />;

  const { roadmap, phases, activePhaseId, weightUnit, metrics } = program;

  return (
    <div>
      <RoadmapSummaryStrip
        roadmapName={roadmap.name}
        longTermGoal={roadmap.longTermGoal}
        goalWeight={roadmap.goalWeight}
        goalBodyFatPercentage={roadmap.goalBodyFatPercentage}
        targetEndDate={roadmap.targetEndDate}
        startedAt={roadmap.startedAt}
        startingWeight={metrics.startingWeight}
        currentWeight={metrics.currentWeight}
        weightUnit={weightUnit}
        phases={phases}
      />
      <div className="mt-4 flex flex-col gap-2 pb-6">
        {phases.map((phase) => (
          <PhaseListItem
            key={phase.id}
            phase={phase}
            isActive={phase.id === activePhaseId}
            weightUnit={weightUnit}
          />
        ))}
      </div>
    </div>
  );
}
