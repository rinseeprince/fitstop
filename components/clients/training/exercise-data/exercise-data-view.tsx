"use client";

import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  ExerciseSearchSelect,
  type ExerciseMetric,
} from "./exercise-search-select";
import { ExerciseTrendChart } from "@/components/training/exercise-data/exercise-trend-chart";
import { ExercisePrView } from "@/components/training/exercise-data/exercise-pr-view";
import { ExerciseKpiStrip } from "./exercise-kpi-strip";
import { computeKpis } from "@/components/training/exercise-data/exercise-insight";
import { useUnits } from "@/contexts/units-context";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

const SESSION_COUNTS: { value: number | "all"; label: string }[] = [
  { value: 8, label: "8" },
  { value: 12, label: "12" },
  { value: 24, label: "24" },
  { value: "all", label: "All" },
];

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
};

type ExerciseDataViewProps = {
  clientId: string;
};

export function ExerciseDataView({ clientId }: ExerciseDataViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    searchParams.get("exerciseId"),
  );
  const [selectedExerciseName, setSelectedExerciseName] = useState<
    string | null
  >(searchParams.get("exerciseName"));

  const [selectedMetric, setSelectedMetric] = useState<ExerciseMetric>("weight");
  const [sessionCount, setSessionCount] = useState<number | "all">(12);

  const { preference } = useUnits();

  const exerciseParam = selectedExerciseId
    ? `exerciseId=${selectedExerciseId}`
    : selectedExerciseName
      ? `exerciseName=${encodeURIComponent(selectedExerciseName)}`
      : null;

  // SWR: exercise list
  const { data: listData, isLoading: listLoading } = useSWR<{
    success: boolean;
    data: ExerciseListItem[];
  }>(
    `/api/clients/${clientId}/training/exercise-history?metric=list`,
    swrFetcher,
    { ...SWR_CONFIG, onError: (err) => console.error("Failed to load exercise list:", err) },
  );

  // SWR: progression data (fetch for all non-PR metrics)
  const progressionUrl =
    exerciseParam && selectedMetric !== "prs"
      ? `/api/clients/${clientId}/training/exercise-history?metric=progression&${exerciseParam}${sessionCount !== "all" ? `&sessionCount=${sessionCount}` : ""}`
      : null;

  const { data: progressionData, isLoading: progressionLoading } = useSWR<{
    success: boolean;
    data: ExerciseProgressionPoint[];
  }>(progressionUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load progression data:", err),
  });

  // SWR: PR data
  const prUrl =
    exerciseParam && selectedMetric === "prs"
      ? `/api/clients/${clientId}/training/exercise-history?metric=prs&${exerciseParam}`
      : null;

  const { data: prData, isLoading: prLoading } = useSWR<{
    success: boolean;
    data: ExercisePR[];
  }>(prUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load PR data:", err),
  });

  // KPIs
  const kpis = useMemo(() => {
    if (selectedMetric === "prs" || !progressionData?.data) return [];
    return computeKpis(selectedMetric, progressionData.data, preference);
  }, [selectedMetric, progressionData, preference]);

  const handleExerciseSelect = (exercise: ExerciseListItem) => {
    setSelectedExerciseId(exercise.exerciseId);
    setSelectedExerciseName(exercise.name);
    const params = new URLSearchParams(searchParams.toString());
    if (exercise.exerciseId) params.set("exerciseId", exercise.exerciseId);
    else params.delete("exerciseId");
    params.set("exerciseName", exercise.name);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const hasExercise = selectedExerciseId != null || selectedExerciseName != null;

  return (
    // Block flow, not space-y: divider spec = 16px above the rail (hero slab
    // mb-4, matching the Data page's hero), 12px below (SectionLabel's mb-3).
    <div>
      {/* 1. Hero slab: exercise picker + the metric lens row (Metrics-hero shape) */}
      <div className="mb-4">
        <ExerciseSearchSelect
          exercises={listData?.data}
          isLoading={listLoading}
          selectedExerciseId={selectedExerciseId}
          selectedExerciseName={selectedExerciseName}
          onSelect={handleExerciseSelect}
          metric={selectedMetric}
          onMetricChange={setSelectedMetric}
        />
      </div>

      {!hasExercise && (
        <p className="text-center text-[13px] text-[#93b0b4] py-12">
          Select an exercise to view progression data.
        </p>
      )}

      {hasExercise && (
        <>
          {/* 2. Divider rail: section identity left, session window right —
              the same slot the Data page's pager occupies. The metric lens
              lives in the hero, so the PRs lens leaves a bare rail. */}
          <SectionLabel
            label={selectedMetric === "prs" ? "Personal records" : "Progression"}
            actions={
              selectedMetric !== "prs" ? (
                <div className="flex items-center gap-1">
                  {SESSION_COUNTS.map((sc) => (
                    <button
                      key={sc.value}
                      type="button"
                      aria-pressed={sessionCount === sc.value}
                      onClick={() => setSessionCount(sc.value)}
                      className={cn(
                        LABEL_CLASS,
                        "rounded-[6px] px-2 py-1 text-[11px] transition-colors",
                        sessionCount === sc.value
                          ? "bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
                          : "hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488]",
                      )}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          />

          {/* 3. KPI strip (hidden for PRs; skipped entirely when empty so the
              rail-to-chart gap stays at the divider spec's 12px) */}
          {selectedMetric !== "prs" && (progressionLoading || kpis.length > 0) && (
            <div className="mb-4">
              <ExerciseKpiStrip kpis={kpis} isLoading={progressionLoading} />
            </div>
          )}

          {/* 4. Chart or PR view */}
          {selectedMetric === "prs" ? (
            <ExercisePrView data={prData?.data} isLoading={prLoading} />
          ) : (
            <ExerciseTrendChart
              data={progressionData?.data}
              metric={selectedMetric}
              isLoading={progressionLoading}
            />
          )}
        </>
      )}
    </div>
  );
}
