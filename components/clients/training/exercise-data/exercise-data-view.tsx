"use client";

import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  ExerciseSearchSelect,
  type ExerciseMetric,
  type ExerciseMetricOption,
} from "./exercise-search-select";
import { ExerciseTrendChart } from "@/components/training/exercise-data/exercise-trend-chart";
import { ExercisePrView } from "@/components/training/exercise-data/exercise-pr-view";
import { ExerciseSessionsTable } from "@/components/training/exercise-data/exercise-sessions-table";
import { SessionLogDetailDialog } from "@/components/clients/training/session-log-detail-dialog";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { ExerciseKpiStrip } from "./exercise-kpi-strip";
import { computeKpis } from "@/components/training/exercise-data/exercise-insight";
import { useUnits } from "@/contexts/units-context";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { coachExerciseHistoryKey } from "@/hooks/use-exercise-history";
import { EXERCISE_HISTORY_MAX_SESSIONS } from "@/lib/training-constants";
import {
  effectiveMarker,
  markerLens,
  offeredMarkers,
} from "@/utils/exercise-progress-markers";
import { DEFAULT_EXERCISE_TYPE } from "@/utils/exercise-types";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

type SessionWindow = number | "all";

const SESSION_COUNTS: { value: SessionWindow; label: string }[] = [
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

  // The selected exercise is the pane's subject and lives in the address
  // alone (CONVENTIONS §7): derived every render, written by the pick below
  // and by the history table's drill-down, carried across a tab change.
  const selectedExerciseId = searchParams.get("exerciseId");
  const selectedExerciseName = searchParams.get("exerciseName");

  // The lens the coach picked; the lens shown derives from it and what the
  // exercise offers, so a pick survives a switch to an exercise that offers
  // it and falls back where it doesn't — no effect resets it.
  const [selectedMetric, setSelectedMetric] = useState<ExerciseMetric>("weight");
  const [sessionCount, setSessionCount] = useState<SessionWindow>(12);

  const { preference } = useUnits();

  // The pane's subject: an id from the catalog, else a freehand name
  const subject = selectedExerciseId ?? selectedExerciseName;

  // SWR: exercise list
  const { data: listData, isLoading: listLoading } = useSWR<{
    success: boolean;
    data: ExerciseListItem[];
  }>(
    coachExerciseHistoryKey(clientId, { metric: "list" }),
    swrFetcher,
    { ...SWR_CONFIG, onError: (err) => console.error("Failed to load exercise list:", err) },
  );

  // SWR: the window's sessions — on every lens, PRs included: the chart, the
  // KPI strip and the Sessions table beneath read this one read, so a lens
  // switch fetches nothing. "All" sends the routes' bound; left out, the
  // database function would floor the read at 12 sessions.
  const progressionUrl =
    subject != null
      ? coachExerciseHistoryKey(clientId, {
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

  // SWR: the exercise's records — the PRs lens's cards, and the stars on the
  // Sessions table's rows on every lens
  const prUrl =
    subject != null
      ? coachExerciseHistoryKey(clientId, {
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

  // The exercise's type, off the list it was picked from: it says which lenses
  // lead; a freehand name that matches no row reads as Strength
  const selectedFromList = listData?.data?.find(
    (ex) =>
      (selectedExerciseId && ex.exerciseId === selectedExerciseId) ||
      (!selectedExerciseId &&
        selectedExerciseName &&
        ex.name.toLowerCase() === selectedExerciseName.toLowerCase()),
  );
  const exerciseType = selectedFromList?.exerciseType ?? DEFAULT_EXERCISE_TYPE;

  // A session's workout, opened from its row in the Sessions table
  const sessionLog = useDialogSubject<string>();

  // The lenses: the type's own at once, and whatever else the logs carry once
  // the progression lands; then PRs
  const points = progressionData?.data;
  // Failed with nothing in hand and no retry in flight: the chart and the table
  // say so together (a retry shows both loading). A refresh that fails over
  // sessions already shown keeps them.
  const progressionFailed =
    progressionError != null && points === undefined && !progressionLoading;
  const retryProgression = () => void mutateProgression();
  const offered = useMemo(
    () => offeredMarkers(exerciseType, points ?? [], "coach"),
    [exerciseType, points],
  );
  const metric: ExerciseMetric =
    selectedMetric === "prs" ? "prs" : effectiveMarker(selectedMetric, offered);
  const lensOptions: ExerciseMetricOption[] = [
    ...offered.map((marker) => ({ value: marker, label: markerLens(exerciseType, marker).label })),
    { value: "prs", label: "PRs" },
  ];

  // KPIs
  const kpis = useMemo(() => {
    if (metric === "prs" || !points) return [];
    return computeKpis(metric, exerciseType, points, preference);
  }, [metric, exerciseType, points, preference]);

  // A refinement of the pane, not a place: one replace and nothing else.
  const handleExerciseSelect = (exercise: ExerciseListItem) => {
    const params = new URLSearchParams(searchParams.toString());
    if (exercise.exerciseId) params.set("exerciseId", exercise.exerciseId);
    else params.delete("exerciseId");
    params.set("exerciseName", exercise.name);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const hasExercise = subject != null;

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
          options={lensOptions}
          metric={metric}
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
              the same slot the Data page's pager occupies. The window governs
              the chart and the Sessions table, so it stays on the PRs lens,
              where the rail says the cards are all-time. */}
          <SectionLabel
            label={metric === "prs" ? "Personal records" : "Progression"}
            actions={
              <div className="flex items-center gap-3">
                {metric === "prs" && (
                  <span className="text-[11px] text-[#93b0b4]">All-time</span>
                )}
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
              </div>
            }
          />

          {/* 3. KPI strip (hidden for PRs; skipped entirely when empty so the
              rail-to-chart gap stays at the divider spec's 12px) */}
          {metric !== "prs" && (progressionLoading || kpis.length > 0) && (
            <div className="mb-4">
              <ExerciseKpiStrip kpis={kpis} isLoading={progressionLoading} />
            </div>
          )}

          {/* 4. Chart or PR view — the 16px above the Sessions rail */}
          <div className="mb-4">
            {metric === "prs" ? (
              <ExercisePrView data={prData?.data} exerciseType={exerciseType} isLoading={prLoading} />
            ) : (
              <ExerciseTrendChart
                data={points}
                metric={metric}
                exerciseType={exerciseType}
                isLoading={progressionLoading}
                isError={progressionFailed}
                onRetry={retryProgression}
              />
            )}
          </div>

          {/* 5. The Sessions table beneath whatever the hero shows. Keyed by the
              exercise: another pick starts it fresh; a lens switch leaves it be.
              Its figures wait for the list that says the exercise's type. */}
          <ExerciseSessionsTable
            key={subject}
            audience="coach"
            points={points}
            exerciseType={listLoading ? undefined : exerciseType}
            records={prData?.data}
            recordsLoading={prLoading}
            isError={progressionFailed}
            onRetry={retryProgression}
            windowKey={String(sessionCount)}
            onOpenSession={(point) => sessionLog.show(point.sessionLogId)}
            canOpenSession={() => true}
          />
        </>
      )}

      <SessionLogDetailDialog
        clientId={clientId}
        sessionLogId={sessionLog.subject}
        open={sessionLog.open}
        onOpenChange={(open) => {
          if (!open) sessionLog.close();
        }}
      />
    </div>
  );
}
