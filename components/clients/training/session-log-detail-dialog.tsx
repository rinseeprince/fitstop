"use client";

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
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SessionLog, ExerciseLog } from "@/types/training";

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
  data: {
    sessionLog: SessionLog;
    exerciseLogs: ExerciseLog[];
  };
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
          <Check className="inline h-3 w-3 -mt-px mr-0.5" />
          Completed
        </span>
      );
    case "partial":
      return <span className="text-amber-600">Partial</span>;
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

/** RPE colour based on deviation from prescribed target. */
function rpeColor(actual: number, prescribedRpe: number | null): string {
  if (prescribedRpe == null) return "text-[#0c1a1e]";
  const diff = actual - prescribedRpe;
  if (diff >= 2) return "text-[#c06060] font-semibold";
  if (diff >= 1) return "text-amber-600";
  return "text-[#0c1a1e]";
}

// ---------------------------------------------------------------------------
// ExerciseLogCard
// ---------------------------------------------------------------------------

function ExerciseLogCard({
  log,
  onExerciseDrillDown,
}: {
  log: ExerciseLog;
  onExerciseDrillDown?: (exerciseId: string | null, exerciseName: string) => void;
}) {
  const snapshot = log.prescribedExerciseSnapshot;
  const prescribedName = snapshotString(snapshot, "name");
  const displayName = log.performedName ?? prescribedName ?? "Unknown exercise";

  const wasSwapped =
    log.performedName != null &&
    prescribedName != null &&
    log.performedName !== prescribedName;

  // Prescribed reference from snapshot
  const prescribedSets = snapshotNumber(snapshot, "sets");
  const prescribedRepsMin = snapshotNumber(snapshot, "reps_min");
  const prescribedRepsMax = snapshotNumber(snapshot, "reps_max");
  const prescribedRepsTarget = snapshotString(snapshot, "reps_target");
  const prescribedRpe = snapshotNumber(snapshot, "rpe_target");

  let prescribedRepsLabel: string | null = null;
  if (prescribedRepsTarget) {
    prescribedRepsLabel = prescribedRepsTarget;
  } else if (prescribedRepsMin != null && prescribedRepsMax != null) {
    prescribedRepsLabel =
      prescribedRepsMin === prescribedRepsMax
        ? `${prescribedRepsMin}`
        : `${prescribedRepsMin} to ${prescribedRepsMax}`;
  } else if (prescribedRepsMin != null) {
    prescribedRepsLabel = `${prescribedRepsMin}`;
  }

  const prescribedParts = [
    prescribedSets != null && prescribedRepsLabel
      ? `${prescribedSets}x${prescribedRepsLabel}`
      : prescribedSets != null
        ? `${prescribedSets} sets`
        : null,
    prescribedRpe != null ? `RPE ${prescribedRpe}` : null,
  ].filter(Boolean);

  const weightHeader = `Weight (${log.weightUnit})`;

  return (
    <div className="border border-[rgba(13,148,136,0.08)] rounded-[6px] overflow-hidden">
      {/* Card header: name left, prescribed right */}
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
        <div>
          <button
            type="button"
            onClick={() => onExerciseDrillDown?.(log.exerciseId ?? null, displayName)}
            className={cn(
              "text-[14px] font-semibold text-[#0c1a1e] text-left",
              onExerciseDrillDown && "hover:text-[#0d9488] cursor-pointer transition-colors",
            )}
          >
            {displayName}
          </button>
          {wasSwapped && (
            <p className="text-[11px] text-[#93b0b4] mt-0.5">
              Prescribed {prescribedName} · Performed {log.performedName}
            </p>
          )}
        </div>
        {prescribedParts.length > 0 && (
          <p className="text-[11px] text-[#93b0b4] ml-4 whitespace-nowrap shrink-0">
            <span className="text-[#b8cfd3]">Prescribed</span>{" "}
            {prescribedParts.join(" @ ")}
          </p>
        )}
      </div>

      {/* Per-set table */}
      {log.sets.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] border-t border-[rgba(13,148,136,0.08)]">
              <th className="text-left font-medium pl-4 pr-2 py-[9px]">Set</th>
              <th className="text-left font-medium px-2 py-[9px]">Reps</th>
              <th className="text-left font-medium px-2 py-[9px]">{weightHeader}</th>
              <th className="text-right font-medium pl-2 pr-4 py-[9px]">RPE</th>
            </tr>
          </thead>
          <tbody>
            {log.sets
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((set) => (
                <tr
                  key={set.id}
                  className="border-t border-[rgba(13,148,136,0.06)]"
                >
                  <td className="pl-4 pr-2 py-[9px] font-mono-display tabular-nums text-[#93b0b4]">
                    {set.setNumber}
                  </td>
                  <td className="px-2 py-[9px] font-mono-display tabular-nums text-[#0c1a1e]">
                    {set.reps ?? <span className="text-[#b8cfd3]">—</span>}
                  </td>
                  <td className="px-2 py-[9px] font-mono-display tabular-nums text-[#0c1a1e]">
                    {set.weight != null ? (
                      set.weight
                    ) : (
                      <span className="text-[#b8cfd3]">—</span>
                    )}
                  </td>
                  <td className={`pl-2 pr-4 py-[9px] font-mono-display tabular-nums text-right ${set.rpe != null ? rpeColor(set.rpe, prescribedRpe) : ""}`}>
                    {set.rpe != null ? (
                      set.rpe
                    ) : (
                      <span className="text-[#b8cfd3]">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {/* Exercise-level notes */}
      {log.notes && (
        <div className="px-4 pb-3 pt-1">
          <p className="text-[11px] text-[#93b0b4] italic">{log.notes}</p>
        </div>
      )}

      {/* Incomplete indicator */}
      {!log.completed && (
        <div className="px-4 pb-3">
          <span className="text-[11px] font-medium text-amber-600">
            Incomplete
          </span>
        </div>
      )}
    </div>
  );
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
  const exerciseLogs = data?.data?.exerciseLogs ?? [];

  const sessionSnapshot = sessionLog?.prescribedSessionSnapshot as Record<string, unknown> | null;
  const sessionName =
    snapshotString(sessionSnapshot, "name") ?? "Training Session";
  const sessionFocus = snapshotString(sessionSnapshot, "focus");
  const estimatedDuration = snapshotNumber(sessionSnapshot, "estimated_duration_minutes");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0">
        {/* Header zone */}
        <DialogHeader className="px-6 pt-6 pb-0 gap-0">
          <DialogTitle className="text-[20px] font-bold text-[#0c1a1e] leading-tight">
            {isLoading ? "Loading..." : sessionName}
          </DialogTitle>
          {!isLoading && sessionLog && (
            <p className="text-[13px] text-[#93b0b4] mt-2 pb-1">
              {formatDate(sessionLog.completedAt)}
              {qualityLabel(sessionLog.completionQuality) && (
                <>
                  <span className="mx-1.5">·</span>
                  {qualityLabel(sessionLog.completionQuality)}
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
                  ~{estimatedDuration} min
                </>
              )}
            </p>
          )}
        </DialogHeader>

        {/* Hairline divider */}
        {!isLoading && sessionLog && (
          <div className="mx-6 border-t border-[rgba(13,148,136,0.08)]" />
        )}

        {/* Loading */}
        {isLoading && (
          <div className="px-6 pb-6 space-y-5 pt-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/* Error */}
        {!isLoading && (error || (data && !data.success)) && (
          <div className="flex items-center justify-center py-12 px-6">
            <p className="text-sm text-[#c06060]">
              Failed to load session details.
            </p>
          </div>
        )}

        {/* Loaded body */}
        {!isLoading && sessionLog && (
          <div className="px-6 pb-6">
            {/* Client notes — quoted block */}
            {sessionLog.notes && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-semibold mb-2">
                  Client Notes
                </p>
                <div className="bg-[rgba(13,148,136,0.03)] border-l-2 border-[#0d9488] rounded-r-[4px] px-4 py-3">
                  <p className="text-[13px] text-[#0c1a1e] italic leading-relaxed">
                    {sessionLog.notes}
                  </p>
                </div>
              </div>
            )}

            {/* Quick-logged state */}
            {exerciseLogs.length === 0 && (
              <div className="mt-[22px] rounded-[6px] bg-[rgba(13,148,136,0.03)] border border-[rgba(13,148,136,0.08)] p-4 text-center">
                <p className="text-[13px] text-[#93b0b4]">
                  Client logged this session as complete without per-set detail.
                </p>
              </div>
            )}

            {/* Detailed / Orphaned state */}
            {exerciseLogs.length > 0 && (
              <div className="mt-[28px]">
                <p className="text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-semibold mb-3">
                  Exercises
                </p>
                <div className="flex flex-col gap-[10px]">
                  {exerciseLogs.map((log) => (
                    <ExerciseLogCard key={log.id} log={log} onExerciseDrillDown={onExerciseDrillDown} />
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
