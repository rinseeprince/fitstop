"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { ChevronDown, Repeat } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { getTodayDateString } from "@/lib/date-helpers";
import { canEditDay } from "@/lib/daily-log-permissions";
import { dateOfTimestamp } from "@/lib/date-helpers";
import { useToast } from "@/hooks/use-toast";
import { logTrainingEventSchema } from "@/lib/validations/training";
import type { Client } from "@/types/check-in";
import type {
  ResolvedExercise,
  ResolvedSession,
  TrainingEvent,
  TrainingEventDetail,
  TrainingSession,
} from "@/types/training";
import {
  ExerciseTrackerBlock,
  type ExerciseFormContext,
  type PrescribedExerciseView,
} from "./exercise-tracker-block";
import { CompleteWorkoutFooter } from "./complete-workout-footer";
import { AddExerciseRow } from "./add-exercise-row";
import { SessionPicker } from "./session-picker";
import { useUnits } from "@/contexts/units-context";
import {
  buildLogPayload,
  prescribedRowsForView,
  seedDefaultValues,
  type ExerciseFormValues,
  type LogFormValues,
} from "./log-form-types";

type EventDetailResponse = { success: boolean; data: TrainingEventDetail };
type SessionDetailResponse = { success: boolean; data: { session: TrainingSession } };
type ClientMeResponse = { success: boolean; data: Client };

// How a logged workout is saved + which session was performed.
type SaveStrategy =
  | { kind: "event"; eventId: string; performedSessionId?: string }
  | { kind: "session"; date: string; performedSessionId: string };

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
} as const;

type SetTrackerProps = {
  /** Event-keyed mode: the client tapped a scheduled event. */
  eventId?: string;
  date?: string;
  /** Event-less mode: a session picked on a rest day (no event). */
  sessionId?: string;
  /** Event-less mode: return to the picker to choose a different session. */
  onChangeSession?: () => void;
};

export function SetTracker(props: SetTrackerProps) {
  if (props.eventId) {
    return <EventModeTracker eventId={props.eventId} date={props.date} />;
  }
  if (props.sessionId && props.date) {
    return (
      <SessionModeTracker
        sessionId={props.sessionId}
        date={props.date}
        onChangeSession={props.onChangeSession}
      />
    );
  }
  return <LoadFailed />;
}

// --- Event-keyed mode (tapped a scheduled event), with optional session swap ---

function EventModeTracker({
  eventId,
  date,
}: {
  eventId: string;
  date?: string;
}) {
  // undefined = not chosen (use the logged swap, if any); null = forced back to
  // the prescribed session; string = a session the user picked.
  const [userSwapSessionId, setUserSwapSessionId] = useState<
    string | null | undefined
  >(undefined);
  const [showPicker, setShowPicker] = useState(false);

  const {
    data: eventData,
    error: eventError,
    isLoading: eventLoading,
  } = useSWR<EventDetailResponse>(
    `/api/client/training/events/${eventId}`,
    swrFetcher,
    {
      ...SWR_OPTS,
      onError: (err) =>
        console.error("[set-tracker] event detail fetch failed:", err),
    },
  );

  const { data: meData, isLoading: meLoading } = useSWR<ClientMeResponse>(
    "/api/client/me",
    swrFetcher,
    { revalidateOnFocus: false },
  );

  // The performed session of the existing log when it's a swap (≠ the event's
  // prescribed session) — so re-entering a logged swap edits what was done.
  const loggedSwap =
    eventData?.data?.sessionLog &&
    eventData.data.sessionLog.trainingSessionId !==
      eventData.data.event.trainingSessionId
      ? eventData.data.sessionLog.trainingSessionId
      : null;
  const boundSessionId =
    userSwapSessionId !== undefined ? userSwapSessionId : loggedSwap;

  // When bound to a non-prescribed session (logged swap or user pick), fetch
  // that session's exercises (active-plan scoped).
  const { data: swapData, isLoading: swapLoading } =
    useSWR<SessionDetailResponse>(
      boundSessionId
        ? `/api/client/training/sessions/${boundSessionId}`
        : null,
      swrFetcher,
      SWR_OPTS,
    );

  if (showPicker) {
    return (
      <SessionPicker
        title="Do a different session"
        onSelect={(id) => {
          setUserSwapSessionId(id);
          setShowPicker(false);
        }}
        onCancel={() => setShowPicker(false)}
      />
    );
  }

  if (eventLoading || meLoading || (boundSessionId && swapLoading)) {
    return <TrackerSkeleton />;
  }
  if (eventError || !eventData) return <LoadFailed />;

  // Logged on another day (an alternative session the matcher attributed to
  // this prescribed event): read-only HERE, whatever day it is — re-logging
  // would overwrite the sets and re-date the log. Edits belong on the day it
  // was done. The server lock in logTrainingEvent mirrors this.
  const doneElsewhere =
    eventData.data.sessionLog != null &&
    dateOfTimestamp(eventData.data.sessionLog.completedAt) !== eventData.data.event.date;
  // Date-edit lock (client mirror of the server rule): past + logged → read-only.
  const editable =
    !doneElsewhere &&
    canEditDay(
      eventData.data.event.date,
      eventData.data.sessionLog ? "logged" : "never-logged",
      meData?.data?.timezone ?? "UTC",
    );

  // Bind to the prescribed session, or to the swapped/edited session.
  let detail = eventData.data;
  let save: SaveStrategy = { kind: "event", eventId };
  if (boundSessionId && swapData?.data?.session) {
    // Pre-fill from the existing log only when we're editing the very session
    // that was logged (so the logged sets match this session's exercises).
    const editingLoggedSession =
      boundSessionId === eventData.data.sessionLog?.trainingSessionId;
    detail = syntheticDetailFromSession(
      swapData.data.session,
      eventData.data.event,
      editingLoggedSession
        ? {
            sessionLog: eventData.data.sessionLog,
            exerciseLogs: eventData.data.exerciseLogs,
          }
        : undefined,
    );
    save = { kind: "event", eventId, performedSessionId: boundSessionId };
  }

  return (
    <TrainingLogForm
      key={boundSessionId ?? "prescribed"}
      detail={detail}
      date={date}
      save={save}
      editable={editable}
      lockedMessage={
        doneElsewhere
          ? "This workout was logged on another day — open it from that day to edit it."
          : undefined
      }
      onChangeSession={() => setShowPicker(true)}
      onResetSwap={
        boundSessionId ? () => setUserSwapSessionId(null) : undefined
      }
    />
  );
}

// --- Event-less mode (rest-day training): a picked session, no event ---

function SessionModeTracker({
  sessionId,
  date,
  onChangeSession,
}: {
  sessionId: string;
  date: string;
  onChangeSession?: () => void;
}) {
  const {
    data: sessionData,
    error: sessionError,
    isLoading: sessionLoading,
  } = useSWR<SessionDetailResponse>(
    `/api/client/training/sessions/${sessionId}`,
    swrFetcher,
    {
      ...SWR_OPTS,
      onError: (err) =>
        console.error("[set-tracker] session fetch failed:", err),
    },
  );

  const { data: meData, isLoading: meLoading } = useSWR<ClientMeResponse>(
    "/api/client/me",
    swrFetcher,
    { revalidateOnFocus: false },
  );

  if (sessionLoading || meLoading) return <TrackerSkeleton />;
  if (sessionError || !sessionData?.data?.session) return <LoadFailed />;

  const session = sessionData.data.session;
  const detail = syntheticDetailFromSession(
    session,
    syntheticEvent(session, date),
  );
  // Fresh rest-day log: locked only when the date is in the future.
  const editable = canEditDay(
    date,
    "never-logged",
    meData?.data?.timezone ?? "UTC",
  );

  return (
    <TrainingLogForm
      detail={detail}
      date={date}
      save={{ kind: "session", date, performedSessionId: sessionId }}
      editable={editable}
      onChangeSession={onChangeSession}
    />
  );
}

function TrainingLogForm({
  detail,
  date,
  save,
  editable = true,
  lockedMessage,
  onChangeSession,
  onResetSwap,
}: {
  detail: TrainingEventDetail;
  date: string | undefined;
  save: SaveStrategy;
  editable?: boolean;
  /** Overrides the default locked-day sentence (e.g. logged on another day). */
  lockedMessage?: string;
  onChangeSession?: () => void;
  onResetSwap?: () => void;
}) {
  const { toast } = useToast();
  const { preference } = useUnits();
  const router = useRouter();
  // Open by default: the ticks ARE the log now. A collapsed list plus one
  // primary button would let a client who did the whole workout tap Complete
  // and record `skipped`. Still foldable for anyone who only wants to bank it.
  const [detailOpen, setDetailOpen] = useState(true);

  const header = normalizeSessionHeader(detail.session, detail.event);
  const formattedDate = formatTrainingDate(date ?? detail.event.date);

  const prescribedViews = useMemo(
    () => detail.exercises.map((e, i) => normalizeExercise(e, i)),
    [detail.exercises],
  );

  // The flattened prescription per form position. Only the prescribed prefix has
  // one — an orphan log or an appended unplanned exercise sits past the end and
  // reads as undefined, which scores neither half of the outcome.
  const prescribedRowsByIndex = useMemo(
    () => prescribedViews.map((v) => prescribedRowsForView(v)),
    [prescribedViews],
  );

  const defaultValues = useMemo<LogFormValues>(
    () =>
      seedDefaultValues({
        prescribedViews,
        sessionLog: detail.sessionLog,
        exerciseLogs: detail.exerciseLogs,
        viewer: preference,
      }),
    [prescribedViews, detail.sessionLog, detail.exerciseLogs, preference],
  );

  const {
    control,
    register,
    setValue,
    getValues,
    handleSubmit,
    formState: { isSubmitting, dirtyFields },
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
    if (!editable) return; // locked day — server also rejects with 403
    // Per WEIGHT FIELD, not per row: editing a set's reps must not cause its
    // untouched weight to round-trip through the rounded display string.
    const base = buildLogPayload(
      values,
      preference,
      (exIndex, setIndex) =>
        Boolean(dirtyFields.exercises?.[exIndex]?.sets?.[setIndex]?.weight),
      prescribedRowsByIndex,
    );
    const parsed = logTrainingEventSchema.safeParse(base);
    if (!parsed.success) {
      toast({
        title: "Couldn't save workout",
        description: "Some inputs are invalid. Please review and try again.",
        variant: "destructive",
      });
      return;
    }

    // Branch on save strategy: event-keyed vs event-less endpoint + body.
    const url =
      save.kind === "event"
        ? `/api/client/training/events/${save.eventId}/log`
        : `/api/client/training/session-logs`;
    const body =
      save.kind === "event"
        ? save.performedSessionId
          ? { ...parsed.data, performedSessionId: save.performedSessionId }
          : parsed.data
        : {
            ...parsed.data,
            date: save.date,
            performedSessionId: save.performedSessionId,
          };
    const loggedDate =
      save.kind === "session" ? save.date : date ?? detail.event.date;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast({
          title: "Couldn't save workout",
          description: errBody?.error ?? "Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Workout logged" });
      // Drop the stale event-detail cache so re-entering refetches logged
      // sets/status (the form seeds defaultValues once per mount). Event mode
      // only — there's no event-detail cache in event-less mode.
      if (save.kind === "event") {
        void globalMutate(
          `/api/client/training/events/${save.eventId}`,
          undefined,
          { revalidate: false },
        );
      }
      void globalMutate(`/api/client/day-summary?date=${loggedDate}`);
      router.push(
        loggedDate === getTodayDateString()
          ? "/client"
          : `/client?date=${loggedDate}`,
      );
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

  const swapped = save.kind === "event" && save.performedSessionId != null;

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
        {!editable && (
          <p
            data-testid="locked-banner"
            className="rounded-[6px] bg-[rgba(13,148,136,0.06)] px-3 py-2 text-[12px] text-[#5a7d82]"
          >
            {lockedMessage ?? "This day is locked — past workouts can\u2019t be edited once logged."}
          </p>
        )}
        {onChangeSession && editable && (
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onChangeSession}
              data-testid="change-session"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7c72]"
            >
              <Repeat className="h-3.5 w-3.5" />
              Do a different session
            </button>
            {swapped && onResetSwap && (
              <button
                type="button"
                onClick={onResetSwap}
                className="text-[12px] text-[#5a7d82] underline-offset-2 hover:underline"
              >
                Back to prescribed
              </button>
            )}
          </div>
        )}
      </header>

      <CompleteWorkoutFooter
        control={control}
        register={register}
        setValue={setValue}
        getValues={getValues}
        prescribedRows={prescribedRowsByIndex}
        editable={editable}
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
              // Nothing prescribed. `sets: 0` is this tree's spelling of that
              // (exercise-tracker-block's zero-guard), which is what makes every
              // row of an unplanned exercise deletable: the row list is entirely
              // the client's own, so there is no prescription for a delete to
              // shift out of alignment.
              const unplannedView: PrescribedExerciseView = {
                id: field.trainingExerciseId || field.id,
                name: field.exerciseName,
                sets: 0,
                isWarmup: false,
              };
              const formContext: ExerciseFormContext = {
                control,
                register,
                setValue,
                getValues,
                isUnplanned: field.isUnplanned,
                onRemove: field.isUnplanned
                  ? () => removeExercise(i)
                  : undefined,
              };
              const prescribedView = prescribedViews[i];
              return (
                <ExerciseTrackerBlock
                  key={field.id}
                  // The PRESCRIPTION, unmodified. It used to carry
                  // `sets: field.sets.length`, which fed the form's own row count
                  // back into expandSetSpecs — so prescribedRows tracked the form
                  // rather than the coach, and "is this row past the
                  // prescription?" could never be true.
                  exercise={
                    field.isUnplanned || !prescribedView
                      ? unplannedView
                      : prescribedView
                  }
                  index={i}
                  formContext={formContext}
                />
              );
            })}
            <AddExerciseRow onAdd={handleAddUnplanned} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </form>
  );
}

// --- Synthetic detail builders for the event-less / swapped flows ---

function syntheticDetailFromSession(
  session: TrainingSession,
  event: TrainingEvent,
  // When editing the session that was actually logged, carry the existing log
  // so the form pre-fills the logged sets (the logs' trainingExerciseIds match
  // this session's exercises).
  logged?: {
    sessionLog: TrainingEventDetail["sessionLog"];
    exerciseLogs: TrainingEventDetail["exerciseLogs"];
  },
): TrainingEventDetail {
  return {
    event,
    session: { source: "live", session },
    exercises: session.exercises.map((exercise) => ({
      source: "live",
      exercise,
    })),
    sessionLog: logged?.sessionLog ?? null,
    exerciseLogs: logged?.exerciseLogs ?? [],
  };
}

// A minimal event carrying just the fields TrainingLogForm reads (date, name,
// focus) for the event-less header. Never persisted — the save goes through the
// event-less /session-logs endpoint.
function syntheticEvent(session: TrainingSession, date: string): TrainingEvent {
  return {
    id: "",
    clientId: "",
    trainingPlanId: session.planId,
    trainingSessionId: session.id,
    date,
    sessionName: session.name,
    sessionFocus: session.focus ?? null,
    estimatedCalories: session.estimatedCalories ?? null,
    status: "scheduled",
    sessionLogId: null,
    isModified: false,
    calorieSurplusPercentage: session.calorieSurplusPercentage,
    createdAt: "",
    updatedAt: "",
  };
}

function TrackerSkeleton() {
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

function LoadFailed() {
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
      setSpecs: e.setSpecs ?? undefined,
      videoUrl: e.videoUrl ?? undefined,
      prescribedFields: e.prescribedFields ?? null,
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
    // Snapshot uses snake_case keys (matches the snapshot writer).
    setSpecs: pick<SetSpec[]>("set_specs"),
    videoUrl: pick<string>("video_url"),
    prescribedFields: pick<string[]>("prescribed_fields") ?? null,
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
    focus: (s.focus as string | undefined) ?? event.sessionFocus ?? undefined,
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
