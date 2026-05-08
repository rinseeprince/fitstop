"use client";

import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import { ExerciseSearchSelect } from "./exercise-search-select";
import { ExerciseTrendChart } from "./exercise-trend-chart";
import { ExercisePrView } from "./exercise-pr-view";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

type Metric = "weight" | "e1rm" | "volume" | "rpe" | "compliance" | "prs";

const METRICS: { value: Metric; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "e1rm", label: "e1RM" },
  { value: "volume", label: "Volume" },
  { value: "rpe", label: "RPE" },
  { value: "compliance", label: "Compliance" },
  { value: "prs", label: "PRs" },
];

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

  // State from URL (exercise selection)
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    searchParams.get("exerciseId"),
  );
  const [selectedExerciseName, setSelectedExerciseName] = useState<
    string | null
  >(searchParams.get("exerciseName"));

  // Ephemeral state
  const [selectedMetric, setSelectedMetric] = useState<Metric>("weight");
  const [sessionCount, setSessionCount] = useState<number | "all">(12);

  // Build exercise identity query param
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
    {
      ...SWR_CONFIG,
      onError: (err) => console.error("Failed to load exercise list:", err),
    },
  );

  // SWR: progression data
  const progressionUrl =
    exerciseParam && selectedMetric !== "prs"
      ? `/api/clients/${clientId}/training/exercise-history?metric=progression&${exerciseParam}${sessionCount !== "all" ? `&sessionCount=${sessionCount}` : ""}`
      : null;

  const { data: progressionData, isLoading: progressionLoading } = useSWR<{
    success: boolean;
    data: ExerciseProgressionPoint[];
  }>(progressionUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) =>
      console.error("Failed to load progression data:", err),
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

  // Date subtitle
  const dateSpan = useMemo(() => {
    const points = progressionData?.data;
    if (!points || points.length < 2) return null;
    const first = points[0];
    const last = points[points.length - 1];
    return `${format(new Date(first.date), "MMM d")} to ${format(new Date(last.date), "MMM d")}`;
  }, [progressionData]);

  // Handle exercise selection
  const handleExerciseSelect = (exercise: ExerciseListItem) => {
    setSelectedExerciseId(exercise.exerciseId);
    setSelectedExerciseName(exercise.name);

    const params = new URLSearchParams(searchParams.toString());
    if (exercise.exerciseId) {
      params.set("exerciseId", exercise.exerciseId);
    } else {
      params.delete("exerciseId");
    }
    params.set("exerciseName", exercise.name);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const hasExercise = selectedExerciseId != null || selectedExerciseName != null;

  return (
    <div className="space-y-4">
      {/* Exercise picker */}
      <ExerciseSearchSelect
        exercises={listData?.data}
        isLoading={listLoading}
        selectedExerciseId={selectedExerciseId}
        selectedExerciseName={selectedExerciseName}
        onSelect={handleExerciseSelect}
      />

      {!hasExercise && (
        <p className="text-center text-[13px] text-[#93b0b4] py-12">
          Select an exercise to view progression data.
        </p>
      )}

      {hasExercise && (
        <>
          {/* Metric segmented control */}
          <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex">
            {METRICS.map((m) => (
              <button
                key={m.value}
                onClick={() => setSelectedMetric(m.value)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-all",
                  selectedMetric === m.value
                    ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                    : "text-[#5a7d82] hover:text-[#0c1a1e]",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Session count picker (hidden for PRs) */}
          {selectedMetric !== "prs" && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#93b0b4] mr-1">Sessions</span>
              {SESSION_COUNTS.map((sc) => (
                <button
                  key={sc.value}
                  onClick={() => setSessionCount(sc.value)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-all",
                    sessionCount === sc.value
                      ? "bg-[#0d9488] text-white"
                      : "text-[#5a7d82] hover:text-[#0c1a1e]",
                  )}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          )}

          {/* Date subtitle */}
          {dateSpan && selectedMetric !== "prs" && (
            <p className="text-[11px] text-[#93b0b4]">{dateSpan}</p>
          )}

          {/* Chart or PR view */}
          {selectedMetric === "prs" ? (
            <ExercisePrView
              data={prData?.data}
              isLoading={prLoading}
            />
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
