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
  GroupScore,
  SessionLog,
  SessionLogDetail,
  SessionLogPrescribedExercise,
  SessionLogPrescribedGroup,
} from "@/types/training";
import {
  exerciseGroupPlace,
  readsAsGroup,
} from "@/utils/exercise-group-display";
import { groupSettingsFromRow, groupSnapshotFormat } from "@/utils/exercise-groups";
import { SessionLogExerciseCard } from "./session-log-exercise-card";
import { SessionLogGroup } from "./session-log-group";

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

/** A group of the prescription, with each of its exercises' entries in order. */
type GroupEntry = {
  group: SessionLogPrescribedGroup;
  entries: ExerciseEntry[];
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

// Full or Partial — how this one workout went, in the words every other
// workout-level label uses (§4.7 M8); "completed" belongs to counts.
function qualityLabel(quality: SessionLog["completionQuality"]) {
  switch (quality) {
    case "full":
      return (
        <span className="text-[#0d9488]">
          <Check className="-mt-px mr-0.5 inline h-3 w-3" />
          Full
        </span>
      );
    case "partial":
      return <span className="text-[#d97706]">Partial</span>;
    default:
      return null;
  }
}

/**
 * A scored group the performed session no longer holds, as the group its score
 * row's snapshot records — the nine keys an exercise snapshot's `group` carries.
 * Null when the snapshot names no format this reader trusts.
 */
function snapshotScoredGroup(score: GroupScore): SessionLogPrescribedGroup | null {
  const row = score.prescribedGroupSnapshot;
  const format = groupSnapshotFormat(row);
  if (format === null) return null;
  const num = (key: string) => {
    const value = row[key];
    return typeof value === "number" ? value : null;
  };
  return {
    id: score.groupId ?? score.id,
    orderIndex: num("order_index") ?? 0,
    ...groupSettingsFromRow({
      format,
      rounds: num("rounds"),
      time_cap_seconds: num("time_cap_seconds"),
      interval_seconds: num("interval_seconds"),
      rest_between_exercises_seconds: num("rest_between_exercises_seconds"),
      rest_between_rounds_seconds: num("rest_between_rounds_seconds"),
      notes: typeof row.notes === "string" ? row.notes : null,
    }),
    exercises: [],
  };
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
 * The body's exercise list: the session's prescription in authored order, group
 * by group, each exercise with its log if the client touched it, then anything
 * logged that the prescription no longer contains.
 *
 * The order mirrors the client's own log form (`seedDefaultValues`), so the
 * coach reads the session in the order the client worked through it. A
 * prescribed exercise with no log renders fully not-done rather than vanishing,
 * which is the whole reason the route returns the prescription at all.
 *
 * The trailing entries cover three real cases: an unplanned exercise the client
 * added, a free-form entry with no `training_exercise_id`, and a prescribed one
 * the coach has since soft-deleted (absent from the live read, but its log and
 * snapshot survive). They belong to no group of the session as it stands.
 */
function buildExerciseEntries(
  prescribedGroups: SessionLogPrescribedGroup[],
  exerciseLogs: ExerciseLog[],
): { groups: GroupEntry[]; extras: ExerciseEntry[] } {
  const logsByExerciseId = new Map<string, ExerciseLog>();
  for (const log of exerciseLogs) {
    if (log.trainingExerciseId !== null) {
      logsByExerciseId.set(log.trainingExerciseId, log);
    }
  }

  const groups: GroupEntry[] = prescribedGroups.map((group) => ({
    group,
    entries: group.exercises.map((prescribed) => ({
      key: prescribed.trainingExerciseId,
      prescribed,
      log: logsByExerciseId.get(prescribed.trainingExerciseId) ?? null,
    })),
  }));

  const prescribedIds = new Set(
    prescribedGroups.flatMap((group) =>
      group.exercises.map((prescribed) => prescribed.trainingExerciseId),
    ),
  );
  const extras: ExerciseEntry[] = [];
  for (const log of exerciseLogs) {
    if (log.trainingExerciseId !== null && prescribedIds.has(log.trainingExerciseId)) {
      continue;
    }
    extras.push({ key: log.id, prescribed: null, log });
  }

  return { groups, extras };
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
  // Keyed on the session log alone, never on `open`: a closing card keeps its
  // data through the exit (CONVENTIONS §7 → "No frame disagrees", rule 5).
  const { data, isLoading, error } = useSWR<SessionLogDetailResponse>(
    sessionLogId
      ? `/api/clients/${clientId}/training/session-logs/${sessionLogId}`
      : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      // No keepPreviousData: the previous session's body would stand under a failed fetch.
      onError: (err) => console.error("Failed to load session log:", err),
    },
  );

  const sessionLog = data?.data?.sessionLog;
  const exerciseLogs = useMemo(() => data?.data?.exerciseLogs ?? [], [data]);
  const prescribedGroups = useMemo(
    () => data?.data?.prescribedGroups ?? [],
    [data],
  );
  const performedSessionName: string | null = data?.data?.performedSessionName ?? null;
  const groupScores = useMemo(() => data?.data?.groupScores ?? [], [data]);

  const entries = useMemo(
    () => buildExerciseEntries(prescribedGroups, exerciseLogs),
    [prescribedGroups, exerciseLogs],
  );
  // The log's scores by the group they score; the rest — a score whose group
  // the performed session no longer holds — read as the groups their snapshots
  // record, after the prescription, with no cards under them.
  const scoreByGroupId = useMemo(
    () => new Map(groupScores.flatMap((s) => (s.groupId ? [[s.groupId, s] as const] : []))),
    [groupScores],
  );
  const orphanScores = useMemo(() => {
    const prescribedIds = new Set(prescribedGroups.map((group) => group.id));
    return groupScores.flatMap((score) => {
      if (score.groupId !== null && prescribedIds.has(score.groupId)) return [];
      const group = snapshotScoredGroup(score);
      return group ? [{ score, group }] : [];
    });
  }, [groupScores, prescribedGroups]);
  const hasEntries =
    entries.groups.length > 0 || entries.extras.length > 0 || orphanScores.length > 0;

  const sessionSnapshot = sessionLog?.prescribedSessionSnapshot ?? null;
  const sessionName = snapshotString(sessionSnapshot, "name") ?? "Training Session";
  const sessionFocus = snapshotString(sessionSnapshot, "focus");
  const estimatedDuration = snapshotNumber(sessionSnapshot, "estimated_duration_minutes");
  const quality = sessionLog ? qualityLabel(sessionLog.completionQuality) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The tray's 780px, so a strength exercise's four columns and a run's
          fit side by side; an exercise with more scrolls sideways inside its
          own card. Never taller than the screen: the header stays put and only
          the body (the second grid row) scrolls — never the DialogContent
          itself, which would scroll its padding and title away. No
          description: the title and the line under it say what this is. */}
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-[780px]"
      >
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
          {/* Hairline divider — the header's last line, so the body below it
              is the grid's scrolling row. */}
          {!isLoading && sessionLog && (
            <div className="border-t border-[rgba(13,148,136,0.08)]" />
          )}
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          {/* Loading */}
          {isLoading && (
            <div className="space-y-5 pt-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {/* Error */}
          {!isLoading && (error || (data && !data.success)) && (
            <div className="flex items-center justify-center pb-6 pt-12">
              <p className="text-sm text-[#c06060]">Failed to load session details.</p>
            </div>
          )}

          {/* Loaded body */}
          {!isLoading && sessionLog && (
            <>
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
              {!hasEntries && (
                <div className="mt-[22px] rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.03)] p-4 text-center">
                  <p className={cn("text-[13px]", TEXT_MUTED)}>
                    Client logged this session as complete without per-set detail.
                  </p>
                </div>
              )}

              {hasEntries && (
                <div className="mt-[28px]">
                  <p className={cn(LABEL_CLASS, "mb-3 font-semibold")}>Exercises</p>
                  <div className="flex flex-col gap-[10px]">
                    {entries.groups.flatMap(({ group, entries: groupEntries }) => {
                      const cards = groupEntries.map((entry, position) => (
                        <SessionLogExerciseCard
                          key={entry.key}
                          log={entry.log}
                          prescribed={entry.prescribed}
                          place={exerciseGroupPlace(group, position)}
                          onExerciseDrillDown={onExerciseDrillDown}
                        />
                      ));
                      // A lone exercise is a plain card; a linked group and a
                      // timed group read as a group.
                      return readsAsGroup(group)
                        ? [
                            <SessionLogGroup
                              key={group.id}
                              group={group}
                              score={scoreByGroupId.get(group.id) ?? null}
                            >
                              {cards}
                            </SessionLogGroup>,
                          ]
                        : cards;
                    })}
                    {entries.extras.map((entry) => (
                      <SessionLogExerciseCard
                        key={entry.key}
                        log={entry.log}
                        prescribed={entry.prescribed}
                        onExerciseDrillDown={onExerciseDrillDown}
                      />
                    ))}
                    {orphanScores.map(({ score, group }) => (
                      <SessionLogGroup key={score.id} group={group} score={score}>
                        {null}
                      </SessionLogGroup>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
