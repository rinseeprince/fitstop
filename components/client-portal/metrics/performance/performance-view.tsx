"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { ExerciseTrendChart } from "@/components/training/exercise-data/exercise-trend-chart";
import { ExercisePrView } from "@/components/training/exercise-data/exercise-pr-view";
import { ExerciseSessionsTable } from "@/components/training/exercise-data/exercise-sessions-table";
import { AllExercisesTable } from "@/components/training/exercise-data/all-exercises-table";
import { ExercisePicker } from "./exercise-picker";
import {
  PerformanceControls,
  type PerformanceMetric,
  type PerformanceMetricOption,
  type PerformanceSessionCount,
} from "./performance-controls";
import { clientExerciseHistoryKey } from "@/hooks/use-exercise-history";
import { EXERCISE_HISTORY_MAX_SESSIONS } from "@/lib/training-constants";
import {
  effectiveMarker,
  markerLens,
  offeredMarkers,
} from "@/utils/exercise-progress-markers";
import { DEFAULT_EXERCISE_TYPE } from "@/utils/exercise-types";
import type {
  ExerciseBestsRow,
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

// Client performance category: All exercises — every exercise's bests in one
// table — or one exercise: its type's markers, the table of its sessions and
// its personal records. Reuses the neutral chart, the two tables and the PR
// viz; a session's row opens the workout it was, an exercise's row opens it.
//
// No weightUnit prop: it threaded a mapper constant down from metrics-hub, so
// the client always saw kilograms whatever their preference. ExercisePrView and
// ExerciseTrendChart now read useUnits() for themselves.
export function PerformanceView() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // The exercise picked lives in the address alone (CONVENTIONS section 7):
  // derived every render, written by the pick; none is All exercises
  const selectedExerciseId = searchParams.get("exerciseId");
  const selectedExerciseName = searchParams.get("exerciseName");
  // The lens picked; the one shown derives from it and what the exercise offers
  const [metric, setMetric] = useState<PerformanceMetric>("weight");
  const [sessionCount, setSessionCount] = useState<PerformanceSessionCount>(12);

  const hasExercise = selectedExerciseId != null || selectedExerciseName != null;

  const { data: listData, isLoading: listLoading } = useSWR<{
    success: boolean;
    data: ExerciseListItem[];
  }>(clientExerciseHistoryKey({ metric: "list" }), swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load exercise list:", err),
  });

  // Every exercise's bests — read only while All exercises is shown
  const {
    data: bestsData,
    error: bestsError,
    isLoading: bestsLoading,
    mutate: mutateBests,
  } = useSWR<{
    success: boolean;
    data: ExerciseBestsRow[];
  }>(hasExercise ? null : clientExerciseHistoryKey({ metric: "bests" }), swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load every exercise's bests:", err),
  });
  // Failed with nothing in hand and no retry in flight
  const bestsFailed = bestsError != null && bestsData === undefined && !bestsLoading;

  const progressionUrl = hasExercise
    ? clientExerciseHistoryKey({
        metric: "progression",
        exerciseId: selectedExerciseId,
        exerciseName: selectedExerciseName,
        sessionCount: sessionCount === "all" ? EXERCISE_HISTORY_MAX_SESSIONS : sessionCount,
      })
    : null;

  const {
    data: progressionData,
    error: progressionError,
    isLoading: progressionLoading,
    mutate: mutateProgression,
  } = useSWR<{
    success: boolean;
    data: ExerciseProgressionPoint[];
  }>(progressionUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load progression data:", err),
  });

  const prUrl = hasExercise
    ? clientExerciseHistoryKey({
        metric: "prs",
        exerciseId: selectedExerciseId,
        exerciseName: selectedExerciseName,
      })
    : null;

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
  const points = progressionData?.data;
  // Failed with nothing in hand and no retry in flight: the chart and the
  // Sessions table say so together
  const progressionFailed =
    progressionError != null && points === undefined && !progressionLoading;
  const retryProgression = () => void mutateProgression();
  const recentCount = useMemo(() => {
    if (!points) return 0;
    const cutoff = Date.now() - 84 * 24 * 60 * 60 * 1000;
    return points.filter((p) => new Date(p.date).getTime() >= cutoff).length;
  }, [points]);

  const selectedFromList = listData?.data?.find(
    (ex) =>
      (selectedExerciseId && ex.exerciseId === selectedExerciseId) ||
      (!selectedExerciseId &&
        selectedExerciseName &&
        ex.name.toLowerCase() === selectedExerciseName.toLowerCase()),
  );
  const displayName = selectedFromList?.name ?? selectedExerciseName ?? "this exercise";
  // The exercise's type, off the list: which lenses lead. A freehand name reads as Strength
  const exerciseType = selectedFromList?.exerciseType ?? DEFAULT_EXERCISE_TYPE;

  const offered = useMemo(
    () => offeredMarkers(exerciseType, points ?? [], "client"),
    [exerciseType, points],
  );
  const shownMetric = effectiveMarker(metric, offered);
  const metricOptions: PerformanceMetricOption[] = offered.map((marker) => ({
    value: marker,
    label: markerLens(exerciseType, marker).label,
  }));

  // A pick is one replace and nothing else — from the picker, or a row of All exercises
  const handleExerciseSelect = (exercise: Pick<ExerciseListItem, "exerciseId" | "name">) => {
    const params = new URLSearchParams(searchParams.toString());
    if (exercise.exerciseId) params.set("exerciseId", exercise.exerciseId);
    else params.delete("exerciseId");
    params.set("exerciseName", exercise.name);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // All exercises: the same one replace, the exercise taken out of the address
  const handleSelectAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("exerciseId");
    params.delete("exerciseName");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <ExercisePicker
        exercises={listData?.data}
        isLoading={listLoading}
        selectedExerciseId={selectedExerciseId}
        selectedExerciseName={selectedExerciseName}
        onSelect={handleExerciseSelect}
        onSelectAll={handleSelectAll}
      />

      {!hasExercise ? (
        // Every exercise's bests under the picker — no chart, no lenses, no window
        <AllExercisesTable
          audience="client"
          rows={bestsData?.data}
          isError={bestsFailed}
          onRetry={() => void mutateBests()}
          onOpenExercise={handleExerciseSelect}
        />
      ) : (
        <>
          <PerformanceControls
            options={metricOptions}
            metric={shownMetric}
            onMetricChange={setMetric}
            sessionCount={sessionCount}
            onSessionCountChange={setSessionCount}
          />

          <ExerciseTrendChart
            data={points}
            metric={shownMetric}
            exerciseType={exerciseType}
            showInsight={false}
            isLoading={progressionLoading}
            isError={progressionFailed}
            onRetry={retryProgression}
          />

          {/* Keyed by the exercise: another pick starts the table fresh. Its
              figures wait for the list that says the exercise's type; a row
              opens the client's own workout. */}
          <ExerciseSessionsTable
            key={selectedExerciseId ?? selectedExerciseName ?? ""}
            audience="client"
            points={points}
            exerciseType={listLoading ? undefined : exerciseType}
            records={prData?.data}
            recordsLoading={prLoading}
            isError={progressionFailed}
            onRetry={retryProgression}
            windowKey={String(sessionCount)}
            onOpenSession={(point) => router.push(`/client/training?eventId=${point.eventId}`)}
            canOpenSession={(point) => point.eventId != null}
          />

          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-[#0c1a1e]">
              Personal Records
            </h2>
            <ExercisePrView data={prData?.data} exerciseType={exerciseType} isLoading={prLoading} />
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
