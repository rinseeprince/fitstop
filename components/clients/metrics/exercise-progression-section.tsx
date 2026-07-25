"use client";

import { useState } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import { ExerciseTrendChart } from "@/components/training/exercise-data/exercise-trend-chart";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
} from "@/types/training";
import type { ResolvedWindow } from "@/lib/metrics/resolve-time-scope";

// Exercise-progression small-multiples on the coach Metrics tab. The shared
// time-scope window (Session 7.5) scopes these charts server-side via RPC date
// bounds, so the single selector that rescopes the body/wellness grid above
// rescopes these too (Session 7.7). Renderers are the audience-neutral ones in
// components/training/exercise-data/ — reused directly, not re-extracted.

type ProgressionMetric = "weight" | "volume" | "rpe";

const METRICS: { value: ProgressionMetric; label: string }[] = [
  { value: "weight", label: "Top set" },
  { value: "volume", label: "Volume" },
  { value: "rpe", label: "Intensity" },
];

// The client's N most-logged exercises render as small-multiples. N+1 requests
// (one list + N progression) — well under coachApiRateLimit (30/10s) for N≤8.
const TOP_N = 6;

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
};

type ExerciseProgressionSectionProps = {
  clientId: string;
  window: ResolvedWindow;
};

function isAllTime(w: ResolvedWindow): boolean {
  return w.start === null && w.end === null;
}

/** Non-null bounds as `startDate=`/`endDate=` query parts. */
function dateParams(w: ResolvedWindow): string[] {
  const parts: string[] = [];
  if (w.start) parts.push(`startDate=${w.start}`);
  if (w.end) parts.push(`endDate=${w.end}`);
  return parts;
}

const ENDPOINT = (clientId: string) =>
  `/api/clients/${clientId}/training/exercise-history`;

export function ExerciseProgressionSection({
  clientId,
  // `window` matches the plan's prop name; aliased to avoid shadowing the global.
  window: scopeWindow,
}: ExerciseProgressionSectionProps) {
  const [metric, setMetric] = useState<ProgressionMetric>("weight");

  // List is window-scoped so the section-level empty state reflects the window.
  const listUrl = `${ENDPOINT(clientId)}?${[
    "metric=list",
    ...(isAllTime(scopeWindow) ? [] : dateParams(scopeWindow)),
  ].join("&")}`;

  const { data: listRes, isLoading: listLoading, error: listError } = useSWR<{
    success: boolean;
    data: ExerciseListItem[];
  }>(listUrl, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load exercise list:", err),
  });

  const exercises = (listRes?.data ?? []).slice(0, TOP_N);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-[#0c1a1e]">
          Exercise progression
        </h3>
        <div className="bg-[rgba(13,148,136,0.06)] rounded-[6px] p-[3px] inline-flex">
          {METRICS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMetric(m.value)}
              className={cn(
                "px-3 py-1 text-[12px] font-medium rounded-[4px] transition-all",
                metric === m.value
                  ? "bg-white text-[#0d9488] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                  : "text-[#5a7d82] hover:text-[#0c1a1e]"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {listLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[320px] w-full rounded-[6px]" />
          <Skeleton className="h-[320px] w-full rounded-[6px]" />
        </div>
      ) : listError ? (
        <p className="text-center text-[13px] text-[#93b0b4] py-12">
          Failed to load exercise data.
        </p>
      ) : exercises.length === 0 ? (
        <p className="text-center text-[13px] text-[#93b0b4] py-12">
          No exercises logged in this window.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {exercises.map((exercise) => (
            <ExerciseProgressionTile
              key={exercise.exerciseId ?? exercise.name}
              clientId={clientId}
              exercise={exercise}
              metric={metric}
              scopeWindow={scopeWindow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type ExerciseProgressionTileProps = {
  clientId: string;
  exercise: ExerciseListItem;
  metric: ProgressionMetric;
  scopeWindow: ResolvedWindow;
};

function ExerciseProgressionTile({
  clientId,
  exercise,
  metric,
  scopeWindow,
}: ExerciseProgressionTileProps) {
  const exerciseParam = exercise.exerciseId
    ? `exerciseId=${exercise.exerciseId}`
    : `exerciseName=${encodeURIComponent(exercise.name)}`;

  // Window → fetch params: a bounded window passes its date bounds and OMITS
  // sessionCount (uncapped within the window); all-time passes no dates +
  // sessionCount=12 (the recency cap, matching the Exercise Data tab default).
  const windowParams = isAllTime(scopeWindow)
    ? ["sessionCount=12"]
    : dateParams(scopeWindow);

  const url = `${ENDPOINT(clientId)}?${[
    "metric=progression",
    exerciseParam,
    ...windowParams,
  ].join("&")}`;

  const { data, isLoading } = useSWR<{
    success: boolean;
    data: ExerciseProgressionPoint[];
  }>(url, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load progression data:", err),
  });

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-[#0c1a1e] px-0.5">
        {exercise.name}
      </p>
      {/* showInsight=false: the trend insight copy hardcodes "kg" and is tuned
          for the single-exercise deep-dive, not a multi-chart grid. */}
      <ExerciseTrendChart
        data={data?.data}
        metric={metric}
        isLoading={isLoading}
        showInsight={false}
      />
    </div>
  );
}
