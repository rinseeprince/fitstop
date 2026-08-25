"use client";

import { Check } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  MONO_CELL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { snapshotToSpecs } from "@/utils/exercise-set-specs";
import { buildPrescribedRows, formatPrescribedLoad } from "@/utils/set-spec-rows";
import { buildLoggedSetRows, type LoggedSetRow } from "@/utils/logged-set-rows";
import { formatRepsRange } from "@/utils/reps-range";
import type { SetType } from "@/utils/exercise-set-specs";
import type { ExerciseLog, SessionLogPrescribedExercise } from "@/types/training";

// One exercise inside the coach's logged-workout dialog: the whole prescription,
// with what the client did against each set.
//
// The PRESCRIPTION drives the row list (utils/logged-set-rows.ts). This card used
// to render `log.sets` directly and build a single "Prescribed 3x8-12" chip from
// the compact snapshot columns — which cannot express warm-ups, per-set loads,
// drop sets or AMRAP, and made a prescribed set the client never reached simply
// disappear.

/**
 * Every non-working set carries its type as a single letter, the way Hevy and
 * Strong tag them. Working sets are untagged: they are the default, and a tag on
 * every row is noise.
 *
 * Colours are the design system's own (docs/newdesignsystem.md): warning for a
 * warm-up, the teal chip for drop/AMRAP, destructive-soft for failure. The
 * client tracker has a twin of this map; it is not shared because the two sit on
 * opposite sides of the coach/client audience split (CONVENTIONS §6) and the
 * client's copy is web-harness code on the RN-replacement path.
 */
const TYPE_TAG: Record<SetType, { letter: string; label: string; className: string } | null> = {
  warmup: {
    letter: "W",
    label: "Warm-up, not scored",
    className: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  },
  drop: {
    letter: "D",
    label: "Drop set",
    className: "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]",
  },
  amrap: {
    letter: "A",
    label: "As many reps as possible",
    className: "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]",
  },
  failure: {
    letter: "F",
    label: "To failure",
    className: "bg-[rgba(192,96,96,0.08)] text-[#c06060]",
  },
  working: null,
};

function SetTypeTag({ setType }: { setType: SetType }) {
  const tag = TYPE_TAG[setType];
  if (!tag) return null;
  return (
    <span
      title={tag.label}
      aria-label={tag.label}
      className={cn(
        "rounded-[4px] px-1 text-[10px] font-semibold leading-[16px]",
        tag.className,
      )}
    >
      {tag.letter}
    </span>
  );
}

/** RPE colour, against the prescribed target for THIS set. */
function rpeToneClass(actual: number, prescribedRpe: number | null): string {
  if (prescribedRpe == null) return TEXT_PRIMARY;
  const diff = actual - prescribedRpe;
  if (diff >= 2) return "font-semibold text-[#c06060]";
  if (diff >= 1) return "text-[#d97706]";
  return TEXT_PRIMARY;
}

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

/**
 * The coach's instruction for one set, as one data string: reps, load, RPE.
 *
 * The load may be absolute (converted to the VIEWER's unit and snapped, because
 * this is a read-only readout) or a percentage, which is unitless and never
 * converts.
 */
function prescribedText(
  row: LoggedSetRow["prescribed"],
  unitLabel: string,
  toDisplayLoad: (kg: number) => string,
): string | null {
  if (!row) return null;
  const reps =
    row.repsTarget ?? formatRepsRange({ min: row.repsMin, max: row.repsMax });
  const load = formatPrescribedLoad(
    row,
    row.loadValue != null ? toDisplayLoad(row.loadValue) : "",
    unitLabel,
  );
  const head = reps && load ? `${reps} @ ${load}` : (reps || load);
  if (!head) return row.rpeTarget != null ? `RPE ${row.rpeTarget}` : null;
  return row.rpeTarget != null ? `${head} · RPE ${row.rpeTarget}` : head;
}

type SessionLogExerciseCardProps = {
  /** The client's log, or null for a prescribed exercise they never touched. */
  log: ExerciseLog | null;
  /** The live prescription, or null for an exercise with no prescription left. */
  prescribed: SessionLogPrescribedExercise | null;
  onExerciseDrillDown?: (exerciseId: string | null, exerciseName: string) => void;
};

export function SessionLogExerciseCard({
  log,
  prescribed,
  onExerciseDrillDown,
}: SessionLogExerciseCardProps) {
  const { preference } = useUnits();
  const unitLabel = formatLoad(0, preference).unit;
  const toDisplayLoad = (kg: number) => String(formatLoad(kg, preference).value);

  // The log's own snapshot is preferred over the live prescription: it is what
  // was prescribed AT LOG TIME, and a coach reading history wants that rather
  // than what the plan says today. The live row is the fallback for an exercise
  // with no log at all.
  const snapshot = log?.prescribedExerciseSnapshot ?? prescribed?.snapshot ?? null;
  const prescribedRows = buildPrescribedRows(snapshotToSpecs(snapshot));
  const rows = buildLoggedSetRows(prescribedRows, log?.sets ?? []);

  const prescribedName =
    (typeof snapshot?.name === "string" ? snapshot.name : null) ??
    prescribed?.name ??
    null;
  const displayName = log?.performedName ?? prescribedName ?? "Unknown exercise";
  const wasSwapped =
    log?.performedName != null &&
    prescribedName != null &&
    log.performedName !== prescribedName;

  // Columns follow the DATA, not the coach's prescribed_fields: a historical
  // readout must never hide something that was actually recorded, and every
  // snapshot written before migration 149 carries no field list at all.
  const showPrescribed = rows.some((r) => r.prescribed !== null);
  const showRpe = rows.some(
    (r) => r.actual?.rpe != null || r.prescribed?.rpeTarget != null,
  );

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
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8 pl-4" />
              <TableHead className="w-16">Set</TableHead>
              {showPrescribed && <TableHead>Prescribed</TableHead>}
              <TableHead>Weight ({unitLabel})</TableHead>
              <TableHead>Reps</TableHead>
              {showRpe && <TableHead className="pr-4 text-right">RPE</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const done = row.actual !== null;
              // A warm-up is recorded but never scored, so it must not read as
              // performance: muted values and a muted tick, beside the W tag.
              const isWarmup = row.prescribed?.setType === "warmup";
              const valueTone = isWarmup ? TEXT_MUTED : TEXT_PRIMARY;
              const text = prescribedText(row.prescribed, unitLabel, toDisplayLoad);

              return (
                <TableRow key={index} data-testid="logged-set-row">
                  <TableCell className="w-8 pl-4">
                    {done ? (
                      <>
                        <Check
                          className={cn(
                            "h-3.5 w-3.5",
                            isWarmup ? TEXT_MUTED : "text-[#0d9488]",
                          )}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        <span className="sr-only">Logged</span>
                      </>
                    ) : (
                      <span className="sr-only">Not done</span>
                    )}
                  </TableCell>
                  <TableCell className="w-16">
                    <span className="flex items-center gap-1">
                      <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY)}>
                        {/* A drop shares its top set's number, so repeating it
                            would read as a duplicate — the tag identifies it. */}
                        {row.prescribed?.dropIndex != null ? "" : row.displayNumber}
                      </span>
                      {row.prescribed && <SetTypeTag setType={row.prescribed.setType} />}
                    </span>
                  </TableCell>
                  {showPrescribed && (
                    <TableCell className={cn(MONO_CELL_CLASS, TEXT_MUTED)}>
                      {text ?? <Dash />}
                    </TableCell>
                  )}
                  <TableCell className={cn(MONO_CELL_CLASS, valueTone)}>
                    {row.actual?.weight != null ? (
                      formatLoad(row.actual.weight, preference).value
                    ) : (
                      <Dash />
                    )}
                  </TableCell>
                  <TableCell className={cn(MONO_CELL_CLASS, valueTone)}>
                    {row.actual?.reps ?? <Dash />}
                  </TableCell>
                  {showRpe && (
                    <TableCell
                      className={cn(
                        MONO_CELL_CLASS,
                        "pr-4 text-right",
                        row.actual?.rpe != null && !isWarmup
                          ? rpeToneClass(row.actual.rpe, row.prescribed?.rpeTarget ?? null)
                          : valueTone,
                      )}
                    >
                      {row.actual?.rpe ?? <Dash />}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {log?.notes && (
        <div className="px-4 pb-3 pt-1">
          <p className={cn("text-[11px] italic", TEXT_MUTED)}>{log.notes}</p>
        </div>
      )}
    </div>
  );
}
