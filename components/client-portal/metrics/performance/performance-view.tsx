"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { ExerciseTrendChart } from "@/components/training/exercise-data/exercise-trend-chart";
import { ExercisePrView } from "@/components/training/exercise-data/exercise-pr-view";
import { ExercisePicker } from "./exercise-picker";
import {
  PerformanceControls,
  type PerformanceMetric,
  type PerformanceSessionCount,
} from "./performance-controls";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
};

const BASE = "/api/client/training/exercise-history";

type PerformanceViewProps = {
  weightUnit: "lbs" | "kg";
};

// Client performance category: pick an exercise, see weight/e1RM/volume
// progression + personal records. Reuses the neutral chart + PR viz; passes
// showInsight={false} so the coach-style (kg-hardcoded) insight strip is hidden.
export function PerformanceView({ weightUnit }: PerformanceViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    searchParams.get("exerciseId"),
  );
  const [selectedExerciseName, setSelectedExerciseName] = useState<string | null>(
    searchParams.get("exerciseName"),
  );
  const [metric, setMetric] = useState<PerformanceMetric>("weight");
  const [sessionCount, setSessionCount] = useState<PerformanceSessionCount>(12);

  const exerciseParam = selectedExerciseId
    ? `exerciseId=${selectedExerciseId}`
    : selectedExerciseName
      ? `exerciseName=${encodeURIComponent(selectedExerciseName)}`
      : null;

  const { data: listData, isLoading: listLoading } = useSWR<{
    success: boolean;
    data: ExerciseListItem[];
  }>(`${BASE}?metric=list`, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load exercise list:", err),
  });

  const progressionUrl = exerciseParam
    ? `${BASE}?metric=progression&${exerciseParam}${sessionCount !== "all" ? `&sessionCount=${sessionCount}` : "&sessionCount=500"}`
    : null;

  const { data: progressionData, isLoading: progressionLoading } = useSWR<{
    success: boolean;
    data: ExerciseProgressionPoint[];
  }>(progressionUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load progression data:", err),
  });

  const prUrl = exerciseParam ? `${BASE}?metric=prs&${exerciseParam}` : null;

  const { data: prData, isLoading: prLoading } = useSWR<{
    success: boolean;
    data: ExercisePR[];
  }>(prUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load PR data:", err),
  });

  // Count sessions logged in the last 12 weeks (84 days). Caveat: the
  // progression series is capped by the picked window, so at the default 12
  // sessions this can undercount a very frequent lifter — acceptable for a
  // motivational stat; widening the window only requires picking "All".
  const recentCount = useMemo(() => {
    const points = progressionData?.data;
    if (!points) return 0;
    const cutoff = Date.now() - 84 * 24 * 60 * 60 * 1000;
    return points.filter((p) => new Date(p.date).getTime() >= cutoff).length;
  }, [progressionData]);

  const displayName =
    listData?.data?.find(
      (ex) =>
        (selectedExerciseId && ex.exerciseId === selectedExerciseId) ||
        (!selectedExerciseId &&
          selectedExerciseName &&
          ex.name.toLowerCase() === selectedExerciseName.toLowerCase()),
    )?.name ??
    selectedExerciseName ??
    "this exercise";

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
    <div className="space-y-4">
      <ExercisePicker
        exercises={listData?.data}
        isLoading={listLoading}
        selectedExerciseId={selectedExerciseId}
        selectedExerciseName={selectedExerciseName}
        onSelect={handleExerciseSelect}
      />

      {!hasExercise ? (
        <p className="py-12 text-center text-[13px] text-[#93b0b4]">
          Pick an exercise above to see how you&apos;re progressing.
        </p>
      ) : (
        <>
          <PerformanceControls
            metric={metric}
            onMetricChange={setMetric}
            sessionCount={sessionCount}
            onSessionCountChange={setSessionCount}
          />

          <ExerciseTrendChart
            data={progressionData?.data}
            metric={metric}
            showInsight={false}
            isLoading={progressionLoading}
          />

          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-[#0c1a1e]">
              Personal Records
            </h2>
            <ExercisePrView
              data={prData?.data}
              weightUnit={weightUnit}
              isLoading={prLoading}
            />
          </section>

          {recentCount > 0 && (
            <p className="text-[12px] text-[#5a7d82]">
              You&apos;ve logged {displayName}{" "}
              <span className="font-mono-display font-medium text-[#0c1a1e]">
                {recentCount}
              </span>{" "}
              {recentCount === 1 ? "time" : "times"} in the last 12 weeks.
            </p>
          )}
        </>
      )}
    </div>
  );
}
