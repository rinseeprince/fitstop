"use client";

import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type {
  ResolvedExercise,
  ResolvedSession,
  TrainingEvent,
  TrainingEventDetail,
} from "@/types/training";
import {
  ExerciseTrackerBlock,
  type PrescribedExerciseView,
} from "./exercise-tracker-block";

type EventDetailResponse = { success: boolean; data: TrainingEventDetail };

type SetTrackerProps = {
  eventId: string;
  date?: string;
};

export function SetTracker({ eventId, date }: SetTrackerProps) {
  const { data, error, isLoading } = useSWR<EventDetailResponse>(
    eventId ? `/api/client/training/events/${eventId}` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      onError: (err) =>
        console.error("[set-tracker] event detail fetch failed:", err),
    },
  );

  if (isLoading) {
    return (
      <div data-testid="set-tracker-skeleton" className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-[6px]" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="font-medium text-[#0c1a1e]">Failed to load workout</p>
          <p className="mt-2 text-[13px] text-[#5a7d82]">
            Please refresh the page or try again in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  const detail = data.data;
  const header = normalizeSessionHeader(detail.session, detail.event);
  const formattedDate = formatTrainingDate(date ?? detail.event.date);
  const exercises = detail.exercises.map((e, i) => normalizeExercise(e, i));

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-[#0c1a1e]">
          {header.name}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#5a7d82]">
          {header.focus && (
            <span className="rounded-[6px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5 text-[#0d9488]">
              {header.focus}
            </span>
          )}
          {header.estimatedDurationMinutes != null && (
            <span>Estimated {header.estimatedDurationMinutes} min</span>
          )}
          {formattedDate && <span>{formattedDate}</span>}
        </div>
      </header>

      {exercises.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-[13px] text-[#5a7d82]">
              No exercises prescribed for this session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {exercises.map((ex, i) => (
            <ExerciseTrackerBlock key={ex.id} exercise={ex} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeExercise(
  resolved: ResolvedExercise,
  index: number,
): PrescribedExerciseView {
  if (resolved.source === "live") {
    const e = resolved.exercise;
    return {
      id: e.id,
      name: e.name,
      sets: Math.max(0, e.sets ?? 0),
      repsMin: e.repsMin,
      repsMax: e.repsMax,
      repsTarget: e.repsTarget,
      rpeTarget: e.rpeTarget,
      restSeconds: e.restSeconds,
      notes: e.notes,
      isWarmup: e.isWarmup ?? false,
    };
  }
  const s = resolved.snapshot;
  const pick = <T,>(k: string): T | undefined => s[k] as T | undefined;
  return {
    id: pick<string>("id") ?? `snapshot-${index}`,
    name: pick<string>("name") ?? "Unknown exercise",
    sets: Math.max(0, pick<number>("sets") ?? 0),
    repsMin: pick<number>("repsMin"),
    repsMax: pick<number>("repsMax"),
    repsTarget: pick<string>("repsTarget"),
    rpeTarget: pick<number>("rpeTarget"),
    restSeconds: pick<number>("restSeconds"),
    notes: pick<string>("notes"),
    isWarmup: pick<boolean>("isWarmup") ?? false,
  };
}

function normalizeSessionHeader(
  resolved: ResolvedSession,
  event: TrainingEvent,
): { name: string; focus?: string; estimatedDurationMinutes?: number } {
  if (resolved.source === "live") {
    return {
      name: resolved.session.name || event.sessionName,
      focus: resolved.session.focus ?? event.sessionFocus ?? undefined,
      estimatedDurationMinutes:
        resolved.session.estimatedDurationMinutes ?? undefined,
    };
  }
  const s = resolved.snapshot;
  return {
    name: (s.name as string | undefined) ?? event.sessionName,
    focus:
      (s.focus as string | undefined) ?? event.sessionFocus ?? undefined,
    estimatedDurationMinutes: s.estimatedDurationMinutes as number | undefined,
  };
}

function formatTrainingDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const local = new Date(Number(y), Number(mo) - 1, Number(d));
  return local.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
