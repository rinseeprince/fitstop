"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { ChevronDown, Repeat, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { toast } from "sonner";
import { logTrainingEventSchema } from "@/lib/validations/training";
import { EMPTY_TRAINING_LOG_MESSAGE } from "@/lib/training-log-content";
import type { Client } from "@/types/check-in";
import type {
  ResolvedExercise,
  ResolvedSession,
  TrainingEvent,
  TrainingEventDetail,
  TrainingSession,
} from "@/types/training";
import type { PrescribedExerciseView } from "./exercise-tracker-block";
import { TrackerExerciseList } from "./tracker-exercise-list";
import { CompleteWorkoutFooter } from "./complete-workout-footer";
import { AddExerciseRow } from "./add-exercise-row";
import { SessionPicker } from "./session-picker";
import { useApplyClientLayout } from "@/hooks/use-client-training-data";
import { CLIENT_PROFILE_KEY } from "@/hooks/use-client-profile";
import { useVisitRead } from "@/hooks/use-visit-read";
import { resolveSessionPick } from "@/lib/session-pick";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";
import { useUnits } from "@/contexts/units-context";
import {
  buildLogPayload,
  prescribedRowsForView,
  seedDefaultValues,
  type ExerciseFormValues,
  type LogFormValues,
} from "./log-form-types";
import { asLiveGroups, sessionExercises } from "@/utils/exercise-groups";

type EventDetailResponse = { success: boolean; data: TrainingEventDetail };
type SessionDetailResponse = { success: boolean; data: { session: TrainingSession } };
type ClientMeResponse = { success: boolean; data: Client };

// How a logged workout is saved + which session was performed.
// A workout is always logged through its event (the client moves the event
// to the day they train first), so there is exactly one save strategy.
type SaveStrategy = { kind: "event"; eventId: string; performedSessionId?: string };

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
} as const;

type SetTrackerProps = {
  /** The event the client tapped (or was routed to after a move/swap). */
  eventId?: string;
  date?: string;
};

export function SetTracker(props: SetTrackerProps) {
  if (props.eventId) {
    return <EventModeTracker eventId={props.eventId} date={props.date} />;
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
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickBusy, setPickBusy] = useState(false);
  const router = useRouter();
  const applyLayout = useApplyClientLayout();

  // The workout and a swapped-in session fill the form once, so both load fresh
  // on every visit (hooks/use-visit-read).
  const { data: eventData, error: eventError } =
    useVisitRead<EventDetailResponse>(`/api/client/training/events/${eventId}`, {
      ...SWR_OPTS,
      onError: (err) =>
        console.error("[set-tracker] event detail fetch failed:", err),
    });

  const { data: meData, isLoading: meLoading } = useSWR<ClientMeResponse>(
    CLIENT_PROFILE_KEY,
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
  const { data: swapData, error: swapError } =
    useVisitRead<SessionDetailResponse>(
      boundSessionId
        ? `/api/client/training/sessions/${boundSessionId}`
        : null,
      SWR_OPTS,
    );

  // What a pick means is decided by lib/session-pick, shared with the rest-day
  // picker (which only offers sessions that can still be done): an other-day
  // session SWAPS days with this one and the tracker reopens on it (one date
  // per workout); once today is logged the pick is an ALT instead — today's
  // log rewritten as that session, nothing moves.
  const handlePick = async (pick: ClientTrainingWeekSession) => {
    const eventDate = eventData?.data?.event.date ?? date ?? pick.date;
    const resolution = resolveSessionPick(pick, {
      kind: "prescribed-day",
      date: date ?? eventDate,
      eventId,
      eventDate,
      logged: !!eventData?.data?.sessionLog,
    });
    setPickError(null);
    switch (resolution.action) {
      case "open":
        setShowPicker(false);
        return;
      case "alt":
        setUserSwapSessionId(resolution.sessionId);
        setShowPicker(false);
        return;
      case "unavailable":
        setPickError(resolution.reason);
        return;
      case "swap":
      case "move": {
        setPickBusy(true);
        try {
          await applyLayout(resolution.moves);
          toast.success("Sessions swapped");
          router.replace(
            `/client/training?eventId=${resolution.openEventId}&date=${date ?? eventDate}`,
          );
        } catch (error) {
          setPickError(error instanceof Error ? error.message : "Failed to swap sessions");
        } finally {
          setPickBusy(false);
        }
      }
    }
  };

  if (showPicker) {
    return (
      <SessionPicker
        title="Do a different session"
        date={date ?? eventData?.data?.event.date ?? ""}
        excludeEventId={eventId}
        onPick={handlePick}
        onCancel={() => setShowPicker(false)}
        error={pickError}
        busy={pickBusy}
      />
    );
  }

  // Only a failed load is a failure; anything not yet loaded is still loading.
  if (eventError) return <LoadFailed />;
  if (!eventData || meLoading || (boundSessionId && !swapData && !swapError)) {
    return <TrackerSkeleton />;
  }

  const sessionLog = eventData.data.sessionLog;
  const timezone = meData?.data?.timezone ?? "UTC";
  // Date-edit lock (client mirror of the server rule). The session's own log
  // state plays no part: what closes a day is the check-in that reported on it.
  const editable = canEditDay(
    eventData.data.event.date,
    meData?.data?.logsOpenFrom ?? null,
    timezone,
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
      onChangeSession={() => setShowPicker(true)}
      onResetSwap={
        boundSessionId ? () => setUserSwapSessionId(null) : undefined
      }
    />
  );
}

function TrainingLogForm({
  detail,
  date,
  save,
  editable = true,
  onChangeSession,
  onResetSwap,
}: {
  detail: TrainingEventDetail;
  date: string | undefined;
  save: SaveStrategy;
  editable?: boolean;
  /** Overrides the default locked-day sentence (e.g. logged on another day). */
  onChangeSession?: () => void;
  onResetSwap?: () => void;
}) {
  const { preference } = useUnits();
  const router = useRouter();
  // Open by default: the ticks ARE the log now, and a collapsed list plus one
  // primary button would leave a client who did the whole workout nothing to
  // tick and nothing to save. Still foldable for anyone who only wants to bank
  // it with "Mark all complete".
  const [detailOpen, setDetailOpen] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const header = normalizeSessionHeader(detail.session, detail.event);
  const formattedDate = formatTrainingDate(date ?? detail.event.date);

  // The prescription in order, group by group — the form's leading exercises.
  // The groups themselves only decide how those exercises are laid out.
  const prescribedViews = useMemo(
    () =>
      sessionExercises({ groups: detail.groups }).map((e, i) =>
        normalizeExercise(e, i),
      ),
    [detail.groups],
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
    if (base === null) {
      // The footer already says this and holds the button; the toast is the
      // belt for a submit that reached here another way.
      toast.error("Couldn't save workout", {
        description: EMPTY_TRAINING_LOG_MESSAGE,
      });
      return;
    }
    const parsed = logTrainingEventSchema.safeParse(base);
    if (!parsed.success) {
      toast.error("Couldn't save workout", {
        description: "Some inputs are invalid. Please review and try again.",
      });
      return;
    }

    const url = `/api/client/training/events/${save.eventId}/log`;
    const body = save.performedSessionId
      ? { ...parsed.data, performedSessionId: save.performedSessionId }
      : parsed.data;
    const loggedDate = date ?? detail.event.date;

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
        toast.error("Couldn't save workout", {
          description: errBody?.error ?? "Please try again in a moment.",
        });
        return;
      }
      toast.success("Workout logged");
      // The workout is saved: the button keeps its spinner until Home replaces
      // this page, rather than offering the save again.
      setLeaving(true);
      void globalMutate(`/api/client/day-summary?date=${loggedDate}`);
      router.push(
        loggedDate === getTodayDateString()
          ? "/client"
          : `/client?date=${loggedDate}`,
      );
    } catch {
      toast.error("Couldn't save workout", {
        description: "Network error. Please try again.",
      });
    }
  };

  // "I did not do this after all". The one way to un-log a workout, and the
  // reason a save may record nothing: it deletes the log and puts the workout
  // back to scheduled, so the client can log it again or leave it.
  const clearLog = async () => {
    const loggedDate = date ?? detail.event.date;
    setClearing(true);
    try {
      const res = await fetch(
        `/api/client/training/events/${save.eventId}/log`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error("Couldn't clear this log", {
          description: errBody?.error ?? "Please try again in a moment.",
        });
        return;
      }
      toast.success("Log cleared");
      setClearOpen(false);
      setLeaving(true);
      void globalMutate(`/api/client/day-summary?date=${loggedDate}`);
      router.push(
        loggedDate === getTodayDateString()
          ? "/client"
          : `/client?date=${loggedDate}`,
      );
    } catch {
      toast.error("Couldn't clear this log", {
        description: "Network error. Please try again.",
      });
    } finally {
      setClearing(false);
    }
  };

  const handleAddUnplanned = (exercise: ExerciseFormValues) => {
    append(exercise);
    setDetailOpen(true);
  };

  const swapped = save.kind === "event" && save.performedSessionId != null;
  // Whether the WORKOUT carries a log — the event's own link, not the bound
  // session's, so Clear log is offered while the client is looking at a swap
  // they have not saved.
  const logged = detail.event.sessionLogId !== null;

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
            This day is locked.
          </p>
        )}
        {editable && (onChangeSession || logged) && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {onChangeSession && (
              <button
                type="button"
                onClick={onChangeSession}
                data-testid="change-session"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7c72]"
              >
                <Repeat className="h-3.5 w-3.5" />
                Do a different session
              </button>
            )}
            {onChangeSession && swapped && onResetSwap && (
              <button
                type="button"
                onClick={onResetSwap}
                className="text-[12px] text-[#5a7d82] underline-offset-2 hover:underline"
              >
                Back to prescribed
              </button>
            )}
            {logged && (
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                disabled={clearing || leaving}
                data-testid="clear-log"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#c06060] transition-colors hover:text-[#a34e4e] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear log
              </button>
            )}
          </div>
        )}
      </header>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={(next) => {
          if (!clearing) setClearOpen(next);
        }}
        title="Clear this log?"
        description="Removes the sets and notes you logged for this workout. It goes back to not logged, and you can log it again."
        confirmLabel={clearing ? "Clearing…" : "Clear log"}
        onConfirm={() => void clearLog()}
        destructive
      />

      <CompleteWorkoutFooter
        control={control}
        register={register}
        setValue={setValue}
        getValues={getValues}
        prescribedRows={prescribedRowsByIndex}
        editable={editable}
        isSubmitting={isSubmitting || leaving}
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
            <TrackerExerciseList
              groups={detail.groups}
              prescribedViews={prescribedViews}
              fields={exerciseFields}
              form={{ control, register, setValue, getValues }}
              onRemoveExercise={removeExercise}
            />
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
  const { groups, ...header } = session;
  return {
    event,
    session: { source: "live", session: header },
    groups: asLiveGroups(groups),
    sessionLog: logged?.sessionLog ?? null,
    exerciseLogs: logged?.exerciseLogs ?? [],
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
