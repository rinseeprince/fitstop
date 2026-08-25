"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { swrFetcher } from "@/lib/swr-fetcher";
import type {
  ExerciseLog,
  SessionLog,
  SessionLogDetail,
  SessionLogPrescribedExercise,
} from "@/types/training";
import { SessionLogExerciseCard } from "./session-log-exercise-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionLogDetailDialogProps = {
  clientId: string;
  sessionLogId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExerciseDrillDown?: (exerciseId: string | null, exerciseName: string) => void;
};

type SessionLogDetailResponse = {
  success: boolean;
  data: SessionLogDetail;
};

/** One row of the body: a prescribed exercise, its log, or both. */
type ExerciseEntry = {
  key: string;
  prescribed: SessionLogPrescribedExercise | null;
  log: ExerciseLog | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function qualityLabel(quality: SessionLog["completionQuality"]) {
  switch (quality) {
    case "full":
      return (
        <span className="text-[#0d9488]">
          <Check className="-mt-px mr-0.5 inline h-3 w-3" />
          Completed
        </span>
      );
    case "partial":
      return <span className="text-[#d97706]">Partial</span>;
    case "skipped":
      return <span className="text-[#c06060]">Missed</span>;
    default:
      return null;
  }
}

function snapshotString(snapshot: Record<string, unknown> | null, key: string): string | null {
  if (!snapshot) return null;
  const val = snapshot[key];
  return typeof val === "string" ? val : null;
}

function snapshotNumber(snapshot: Record<string, unknown> | null, key: string): number | null {
  if (!snapshot) return null;
  const val = snapshot[key];
  return typeof val === "number" ? val : null;
}

/**
 * The body's exercise list: the session's prescription in authored order, each
 * with its log if the client touched it, then anything logged that the
 * prescription no longer contains.
 *
 * The order mirrors the client's own log form (`seedDefaultValues`), so the
 * coach reads the session in the order the client worked through it. A
 * prescribed exercise with no log renders fully not-done rather than vanishing,
 * which is the whole reason the route returns the prescription at all.
 *
 * The trailing group covers three real cases: an unplanned exercise the client
 * added, a free-form entry with no `training_exercise_id`, and a prescribed one
 * the coach has since soft-deleted (absent from the live read, but its log and
 * snapshot survive).
 */
function buildExerciseEntries(
  prescribedExercises: SessionLogPrescribedExercise[],
  exerciseLogs: ExerciseLog[],
): ExerciseEntry[] {
  const logsByExerciseId = new Map<string, ExerciseLog>();
  for (const log of exerciseLogs) {
    if (log.trainingExerciseId !== null) {
      logsByExerciseId.set(log.trainingExerciseId, log);
    }
  }

  const entries: ExerciseEntry[] = prescribedExercises.map((prescribed) => ({
    key: prescribed.trainingExerciseId,
    prescribed,
    log: logsByExerciseId.get(prescribed.trainingExerciseId) ?? null,
  }));

  const prescribedIds = new Set(
    prescribedExercises.map((p) => p.trainingExerciseId),
  );
  for (const log of exerciseLogs) {
    if (log.trainingExerciseId !== null && prescribedIds.has(log.trainingExerciseId)) {
      continue;
    }
    entries.push({ key: log.id, prescribed: null, log });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// SessionLogDetailDialog
// ---------------------------------------------------------------------------

export function SessionLogDetailDialog({
  clientId,
  sessionLogId,
  open,
  onOpenChange,
  onExerciseDrillDown,
}: SessionLogDetailDialogProps) {
  const { data, isLoading, error } = useSWR<SessionLogDetailResponse>(
    open && sessionLogId
      ? `/api/clients/${clientId}/training/session-logs/${sessionLogId}`
      : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      keepPreviousData: true,
      onError: (err) => console.error("Failed to load session log:", err),
    },
  );

  const sessionLog = data?.data?.sessionLog;
  const exerciseLogs = useMemo(() => data?.data?.exerciseLogs ?? [], [data]);
  const prescribedExercises = useMemo(
    () => data?.data?.prescribedExercises ?? [],
    [data],
  );
  const performedSessionName: string | null = data?.data?.performedSessionName ?? null;

  const entries = useMemo(
    () => buildExerciseEntries(prescribedExercises, exerciseLogs),
    [prescribedExercises, exerciseLogs],
  );

  const sessionSnapshot = sessionLog?.prescribedSessionSnapshot ?? null;
  const sessionName = snapshotString(sessionSnapshot, "name") ?? "Training Session";
  const sessionFocus = snapshotString(sessionSnapshot, "focus");
  const estimatedDuration = snapshotNumber(sessionSnapshot, "estimated_duration_minutes");
  const quality = sessionLog ? qualityLabel(sessionLog.completionQuality) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-0 sm:max-w-2xl">
        {/* Header zone */}
        <DialogHeader className="gap-0 px-6 pb-0 pt-6">
          <DialogTitle className={cn("text-[20px] font-bold leading-tight", TEXT_PRIMARY)}>
            {isLoading ? "Loading..." : sessionName}
          </DialogTitle>
          {!isLoading && sessionLog && (
            // A sans line: it mixes words ("Completed", the focus) with data, and
            // mono is numbers only — so only the date and the duration take it.
            <p className={cn("mt-2 pb-1 text-[13px]", TEXT_SECONDARY)}>
              <span className={MONO}>{formatDate(sessionLog.completedAt)}</span>
              {quality && (
                <>
                  <span className="mx-1.5">·</span>
                  {quality}
                </>
              )}
              {sessionFocus && (
                <>
                  <span className="mx-1.5">·</span>
                  {sessionFocus}
                </>
              )}
              {estimatedDuration != null && (
                <>
                  <span className="mx-1.5">·</span>
                  <span className={MONO}>~{estimatedDuration} min</span>
                </>
              )}
            </p>
          )}
          {/* Session-level swap: the client performed a different session than
              prescribed. Distinct from the per-exercise swap shown in the body. */}
          {!isLoading &&
            sessionLog &&
            performedSessionName &&
            performedSessionName !== sessionName && (
              <p className="mt-1.5 text-[13px]">
                <span className={TEXT_MUTED}>Prescribed </span>
                <span className={cn("font-medium", TEXT_PRIMARY)}>{sessionName}</span>
                <span className={TEXT_MUTED}> · Performed </span>
                <span className={cn("font-medium", TEXT_PRIMARY)}>
                  {performedSessionName}
                </span>
              </p>
            )}
        </DialogHeader>

        {/* Hairline divider */}
        {!isLoading && sessionLog && (
          <div className="mx-6 border-t border-[rgba(13,148,136,0.08)]" />
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-5 px-6 pb-6 pt-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/* Error */}
        {!isLoading && (error || (data && !data.success)) && (
          <div className="flex items-center justify-center px-6 py-12">
            <p className="text-sm text-[#c06060]">Failed to load session details.</p>
          </div>
        )}

        {/* Loaded body */}
        {!isLoading && sessionLog && (
          <div className="px-6 pb-6">
            {/* Client notes — quoted block */}
            {sessionLog.notes && (
              <div className="mt-3">
                <p className={cn(LABEL_CLASS, "mb-2 font-semibold")}>Client Notes</p>
                <div className="rounded-r-[4px] border-l-2 border-[#0d9488] bg-[rgba(13,148,136,0.03)] px-4 py-3">
                  <p className={cn("text-[13px] italic leading-relaxed", TEXT_PRIMARY)}>
                    {sessionLog.notes}
                  </p>
                </div>
              </div>
            )}

            {/* Quick-logged state: nothing prescribed to show, and nothing logged
                against it. */}
            {entries.length === 0 && (
              <div className="mt-[22px] rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.03)] p-4 text-center">
                <p className={cn("text-[13px]", TEXT_MUTED)}>
                  Client logged this session as complete without per-set detail.
                </p>
              </div>
            )}

            {entries.length > 0 && (
              <div className="mt-[28px]">
                <p className={cn(LABEL_CLASS, "mb-3 font-semibold")}>Exercises</p>
                <div className="flex flex-col gap-[10px]">
                  {entries.map((entry) => (
                    <SessionLogExerciseCard
                      key={entry.key}
                      log={entry.log}
                      prescribed={entry.prescribed}
                      onExerciseDrillDown={onExerciseDrillDown}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
