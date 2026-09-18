"use client";

import { cn } from "@/lib/utils";
import {
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { snapshotToSpecs } from "@/utils/exercise-set-specs";
import { buildPrescribedRows } from "@/utils/set-spec-rows";
import { buildLoggedSetRows, loggedColumns } from "@/utils/logged-set-rows";
import { snapshotPrescribedFields } from "@/utils/prescribed-fields";
import { LONE_EXERCISE, type ExerciseGroupPlace } from "@/utils/exercise-group-display";
import type { ExerciseLog, SessionLogPrescribedExercise } from "@/types/training";
import { SessionLogSetTable } from "./session-log-set-table";

// One exercise inside the coach's logged-workout dialog: the whole prescription,
// with what the client did against each set, measure by measure — the target
// over the value (session-log-set-table.tsx).
//
// The PRESCRIPTION drives the row list (utils/logged-set-rows.ts): a prescribed
// set the client never reached still shows, as not done. Its columns follow the
// exercise's own — every box the coach prescribed — and the DATA, so a value
// recorded in a column the prescription doesn't name still shows
// (`loggedColumns`); a snapshot from before the column list existed reads as
// today's five.

type SessionLogExerciseCardProps = {
  /** The client's log, or null for a prescribed exercise they never touched. */
  log: ExerciseLog | null;
  /** The live prescription, or null for an exercise with no prescription left. */
  prescribed: SessionLogPrescribedExercise | null;
  /**
   * Where the exercise sits in its group: in a superset or circuit each row is
   * one round, and the group's rests apply rather than the exercise's own.
   * Absent reads as a lone exercise.
   */
  place?: Readonly<ExerciseGroupPlace>;
  onExerciseDrillDown?: (exerciseId: string | null, exerciseName: string) => void;
};

export function SessionLogExerciseCard({
  log,
  prescribed,
  place = LONE_EXERCISE,
  onExerciseDrillDown,
}: SessionLogExerciseCardProps) {
  const { preference } = useUnits();

  // The log's own snapshot is preferred over the live prescription: it is what
  // was prescribed AT LOG TIME, and a coach reading history wants that rather
  // than what the plan says today. The live row is the fallback for an exercise
  // with no log at all.
  const snapshot = log?.prescribedExerciseSnapshot ?? prescribed?.snapshot ?? null;
  const rows = buildLoggedSetRows(buildPrescribedRows(snapshotToSpecs(snapshot)), log?.sets ?? []);
  const fields = snapshotPrescribedFields(snapshot);
  const columns = loggedColumns(fields, rows, preference);

  const prescribedName =
    (typeof snapshot?.name === "string" ? snapshot.name : null) ??
    prescribed?.name ??
    null;
  const displayName = log?.performedName ?? prescribedName ?? "Unknown exercise";
  const wasSwapped =
    log?.performedName != null &&
    prescribedName != null &&
    log.performedName !== prescribedName;

  return (
    <div className="overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)]">
      <div className="px-4 pb-2 pt-3">
        <button
          type="button"
          onClick={() => onExerciseDrillDown?.(log?.exerciseId ?? null, displayName)}
          className={cn(
            "text-left text-[14px] font-semibold",
            TEXT_PRIMARY,
            onExerciseDrillDown &&
              "cursor-pointer transition-colors hover:text-[#0d9488]",
          )}
        >
          {displayName}
        </button>
        {wasSwapped && (
          <p className={cn("mt-0.5 text-[11px]", TEXT_MUTED)}>
            Prescribed {prescribedName} · Performed {log?.performedName}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <SessionLogSetTable
          rows={rows}
          columns={columns}
          place={place}
          ownRestApplies={fields.has("rest") && !place.roundsAreRows}
          viewer={preference}
        />
      )}

      {log?.notes && (
        <div className="px-4 pb-3 pt-1">
          <p className={cn("text-[11px] italic", TEXT_MUTED)}>{log.notes}</p>
        </div>
      )}
    </div>
  );
}
