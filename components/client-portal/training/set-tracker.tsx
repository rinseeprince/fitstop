"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useFieldArray, useForm } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useToast } from "@/hooks/use-toast";
import { logTrainingEventSchema } from "@/lib/validations/training";
import type { Client } from "@/types/check-in";
import type {
  ResolvedExercise,
  ResolvedSession,
  TrainingEvent,
  TrainingEventDetail,
} from "@/types/training";
import {
  ExerciseTrackerBlock,
  type ExerciseFormContext,
  type PrescribedExerciseView,
} from "./exercise-tracker-block";
import { QuickLogControls } from "./quick-log-controls";
import { AddExerciseRow } from "./add-exercise-row";
import {
  buildLogPayload,
  seedDefaultValues,
  type ExerciseFormValues,
  type LogFormValues,
} from "./log-form-types";

type EventDetailResponse = { success: boolean; data: TrainingEventDetail };
type ClientMeResponse = { success: boolean; data: Client };

type SetTrackerProps = {
  eventId: string;
  date?: string;
};

export function SetTracker({ eventId, date }: SetTrackerProps) {
  const {
    data: eventData,
    error: eventError,
    isLoading: eventLoading,
  } = useSWR<EventDetailResponse>(
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

  const { data: meData, isLoading: meLoading } = useSWR<ClientMeResponse>(
    "/api/client/me",
    swrFetcher,
    {
      revalidateOnFocus: false,
      onError: (err) =>
        console.error("[set-tracker] /api/client/me fetch failed:", err),
    },
  );

  if (eventLoading || meLoading) {
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

  if (eventError || !eventData) {
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

  const weightUnit: "lbs" | "kg" = meData?.data?.weightUnit ?? "lbs";

  return (
    <TrainingLogForm
      eventId={eventId}
      date={date}
      detail={eventData.data}
      weightUnit={weightUnit}
    />
  );
}

function TrainingLogForm({
  eventId,
  date,
  detail,
  weightUnit,
}: {
  eventId: string;
  date: string | undefined;
  detail: TrainingEventDetail;
  weightUnit: "lbs" | "kg";
}) {
  const { toast } = useToast();
  const [detailOpen, setDetailOpen] = useState(false);

  const header = normalizeSessionHeader(detail.session, detail.event);
  const formattedDate = formatTrainingDate(date ?? detail.event.date);

  const prescribedViews = useMemo(
    () => detail.exercises.map((e, i) => normalizeExercise(e, i)),
    [detail.exercises],
  );

  const defaultValues = useMemo<LogFormValues>(
    () =>
      seedDefaultValues({
        prescribedViews,
        sessionLog: detail.sessionLog,
        exerciseLogs: detail.exerciseLogs,
        weightUnit,
      }),
    [prescribedViews, detail.sessionLog, detail.exerciseLogs, weightUnit],
  );

  const {
    control,
    register,
    setValue,
    getValues,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LogFormValues>({ defaultValues });

  const {
    fields: exerciseFields,
    append,
    remove: removeExercise,
  } = useFieldArray({
    control,
    name: "exercises",
  });

  const onSubmit = async (values: LogFormValues) => {
    const payload = buildLogPayload(values);
    const parsed = logTrainingEventSchema.safeParse(payload);
    if (!parsed.success) {
      toast({
        title: "Couldn't save workout",
        description: "Some inputs are invalid. Please review and try again.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(
        `/api/client/training/events/${eventId}/log`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(parsed.data),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast({
          title: "Couldn't save workout",
          description: body?.error ?? "Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Workout logged" });
    } catch {
      toast({
        title: "Couldn't save workout",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddUnplanned = (exercise: ExerciseFormValues) => {
    append(exercise);
    setDetailOpen(true);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

      <QuickLogControls
        control={control}
        register={register}
        setValue={setValue}
        getValues={getValues}
        isSubmitting={isSubmitting}
      />

      {exerciseFields.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-[13px] text-[#5a7d82]">
              No exercises prescribed for this session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
          <CollapsibleTrigger
            data-testid="detailed-toggle"
            className="flex w-full items-center justify-between rounded-[6px] bg-white px-4 py-3 text-left text-[14px] font-medium text-[#0c1a1e] transition-colors hover:bg-[rgba(13,148,136,0.04)]"
          >
            <span>Log detailed performance</span>
            <ChevronDown
              className={`h-4 w-4 text-[#5a7d82] transition-transform ${
                detailOpen ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {exerciseFields.map((field, i) => {
              const view: PrescribedExerciseView = {
                id: field.trainingExerciseId || field.id,
                name: field.exerciseName,
                sets: field.sets.length,
                isWarmup: false,
              };
              const formContext: ExerciseFormContext = {
                control,
                register,
                setValue,
                getValues,
                weightUnit: field.weightUnit,
                isUnplanned: field.isUnplanned,
                onRemove: field.isUnplanned
                  ? () => removeExercise(i)
                  : undefined,
              };
              const prescribedView = prescribedViews[i] ?? view;
              return (
                <ExerciseTrackerBlock
                  key={field.id}
                  exercise={
                    field.isUnplanned
                      ? view
                      : { ...prescribedView, sets: field.sets.length }
                  }
                  index={i}
                  formContext={formContext}
                />
              );
            })}
            <AddExerciseRow weightUnit={weightUnit} onAdd={handleAddUnplanned} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </form>
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
