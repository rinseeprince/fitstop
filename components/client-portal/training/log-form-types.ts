import type { LogTrainingEventInput } from "@/lib/validations/training";
import type { ExerciseLog, SessionLog } from "@/types/training";
import type { PrescribedExerciseView } from "./exercise-tracker-block";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import { buildPrescribedRows } from "@/utils/set-spec-rows";
import { parseWeightToKg, type UnitSystem } from "@/utils/unit-conversions";
import { displayLoad } from "@/components/clients/training/program-builder/commit-input";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetRowValues = {
  reps: string;
  weight: string;
  rpe: string;
  /**
   * The canonical KILOGRAMS this row was seeded from, carried alongside the
   * display string it produced.
   *
   * The display string is rounded for legibility, so re-parsing an untouched
   * field would not land back on the value it came from — a set logged at 100 kg
   * seeds as "220.5" for an imperial client and parses back to 100.017. Keeping
   * the original means an untouched weight resubmits byte-identical. null for a
   * fresh row that has never been logged.
   */
  weightKg: number | null;
};

export type ExerciseFormValues = {
  trainingExerciseId: string;
  exerciseId?: string;
  exerciseName: string;
  prescribedName?: string;
  isSwapped: boolean;
  skipped: boolean;
  notes: string;
  sets: SetRowValues[];
  isUnplanned: boolean;
};

export type LogFormValues = {
  completionQuality: "" | "full" | "partial" | "skipped";
  notes: string;
  exercises: ExerciseFormValues[];
};

export function emptySet(): SetRowValues {
  return { reps: "", weight: "", rpe: "", weightKg: null };
}

/**
 * Build the wire payload, converting to canonical kilograms HERE rather than
 * sending the client's display unit and a tag for the server to apply.
 *
 * The conversion is evaluated PER WEIGHT FIELD, never per row. A set row is
 * dirty the moment the client edits its reps — under a row-level rule its
 * untouched weight would still round-trip through the rounded display string
 * and drift the logged value, on the commonest edit in this form. An untouched
 * weight resubmits the exact kilograms it was seeded with.
 *
 * `weightUnit` therefore leaves as "kg" always. The wire schema still carries it
 * (lib/validations/training.ts) and training-log-service still applies it, so
 * any other caller — the React Native client — is unaffected.
 */
export function buildLogPayload(
  values: LogFormValues,
  viewer: UnitSystem,
  isWeightDirty: (exerciseIndex: number, setIndex: number) => boolean,
): LogTrainingEventInput {
  const detailed = values.exercises
    .map((ex, exIndex) => {
      const filledSets = ex.sets
        .map((s, setIndex) => ({
          // The row's position in THIS form's row list. The server reads it as
          // an index into the flattened prescription (prescribedRows[n - 1]),
          // so the two agree only while the form's rows mirror that list.
          //
          // They do when the form is seeded fresh (seededSetRows builds it from
          // buildPrescribedRows). They do NOT yet on two paths, both Phase 2's
          // to close: reopening a logged session re-seeds from the LOGGED rows
          // only (restoreSetsFromLog), and the grid lets a client delete or
          // append rows. Either shifts later rows onto the wrong spec.
          //
          // Minting it here, before the filter below, closes a third cause:
          // selecting first and numbering after renumbered a logged subset down
          // to 1..n, so a lone working set was stored as set 1 and typed from
          // the warm-up spec.
          setNumber: setIndex + 1,
          reps: s.reps.trim() ? Number(s.reps) : undefined,
          weight: isWeightDirty(exIndex, setIndex)
            ? s.weight.trim()
              ? parseWeightToKg(Number(s.weight), viewer)
              : undefined
            : (s.weightKg ?? undefined),
          rpe: s.rpe.trim() ? Number(s.rpe) : undefined,
        }))
        .filter((s) => s.reps != null || s.weight != null || s.rpe != null);

      const hasAnyDetail = filledSets.length > 0 || ex.skipped;
      if (!hasAnyDetail) return null;

      const trimmedNotes = ex.notes.trim();
      return {
        ...(UUID_RE.test(ex.trainingExerciseId) && {
          trainingExerciseId: ex.trainingExerciseId,
        }),
        ...(ex.exerciseId &&
          UUID_RE.test(ex.exerciseId) && { exerciseId: ex.exerciseId }),
        exerciseName: ex.exerciseName,
        sets: ex.skipped ? [] : filledSets,
        // Already canonical — see the note above.
        weightUnit: "kg" as const,
        ...(trimmedNotes && { notes: trimmedNotes }),
        ...(ex.skipped && { skipped: true }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const trimmedNotes = values.notes.trim();
  const base: LogTrainingEventInput = {
    completionQuality: values.completionQuality as
      | "full"
      | "partial"
      | "skipped",
    ...(trimmedNotes && { notes: trimmedNotes }),
  };
  return detailed.length > 0 ? { ...base, exercises: detailed } : base;
}

// Restoration reads structured set data from set_logs (attached to ExerciseLog
// by the service reader). Per-set fidelity (reps, weight, RPE) is preserved
// exactly as logged.
function restoreSetsFromLog(log: ExerciseLog, viewer: UnitSystem): SetRowValues[] {
  if (log.sets.length === 0) return [emptySet()];
  return [...log.sets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => ({
      reps: s.reps != null ? String(s.reps) : "",
      // Unsnapped, never formatLoad: this seeds an editable field, and a snap
      // would round-trip into the logged value.
      weight: displayLoad(s.weight, viewer),
      rpe: s.rpe != null ? String(s.rpe) : "",
      weightKg: s.weight ?? null,
    }));
}

function displayName(log: ExerciseLog): string {
  return (
    log.performedName ??
    (log.prescribedExerciseSnapshot?.name as string | undefined) ??
    "Unplanned exercise"
  );
}

function isSkippedLog(log: ExerciseLog): boolean {
  return log.completed === false && log.sets.length === 0;
}

// Seed the log form's set rows from the prescription so the row COUNT matches
// what the coach prescribed; the values stay client-entered (set_type is applied
// server-side, never chosen here).
//
// Flattened, so a drop set contributes its top set PLUS one row per drop — the
// same expansion training-log-service uses when it stamps set_type. The two must
// agree or every row after a drop set is typed from the wrong spec.
function seededSetRows(v: PrescribedExerciseView): SetRowValues[] {
  const rows = buildPrescribedRows(expandSetSpecs({
    setSpecs: v.setSpecs ?? null,
    sets: v.sets,
    repsMin: v.repsMin ?? null,
    repsMax: v.repsMax ?? null,
    repsTarget: v.repsTarget ?? null,
    rpeTarget: v.rpeTarget ?? null,
    restSeconds: v.restSeconds ?? null,
  }));
  return Array.from({ length: Math.max(1, rows.length) }, () => emptySet());
}

export function seedDefaultValues(args: {
  prescribedViews: PrescribedExerciseView[];
  sessionLog: SessionLog | null;
  exerciseLogs: ExerciseLog[];
  /** The VIEWER's system. Display seeds convert to it; storage stays kilograms. */
  viewer: UnitSystem;
}): LogFormValues {
  const { prescribedViews, sessionLog, exerciseLogs, viewer } = args;

  if (sessionLog === null) {
    return {
      completionQuality: "",
      notes: "",
      exercises: prescribedViews.map((v) => ({
        trainingExerciseId: v.id,
        exerciseId: undefined,
        exerciseName: v.name,
        prescribedName: v.name,
        isSwapped: false,
        skipped: false,
        notes: "",
        sets: seededSetRows(v),
        isUnplanned: false,
      })),
    };
  }

  const logsByExerciseId = new Map<string, ExerciseLog>();
  for (const log of exerciseLogs) {
    if (log.trainingExerciseId !== null) {
      logsByExerciseId.set(log.trainingExerciseId, log);
    }
  }

  const prescribedExercises: ExerciseFormValues[] = prescribedViews.map((v) => {
    const log = logsByExerciseId.get(v.id);
    if (!log) {
      return {
        trainingExerciseId: v.id,
        exerciseId: undefined,
        exerciseName: v.name,
        prescribedName: v.name,
        isSwapped: false,
        skipped: false,
        notes: "",
        sets: seededSetRows(v),
        isUnplanned: false,
      };
    }
    const skipped = isSkippedLog(log);
    const performed = displayName(log);
    const isSwapped =
      log.performedName != null &&
      typeof log.prescribedExerciseSnapshot?.name === "string" &&
      log.performedName !== log.prescribedExerciseSnapshot.name;
    return {
      trainingExerciseId: v.id,
      exerciseId: log.exerciseId ?? undefined,
      exerciseName: performed,
      prescribedName: v.name,
      isSwapped,
      skipped,
      notes: log.notes ?? "",
      sets: skipped ? [emptySet()] : restoreSetsFromLog(log, viewer),
      isUnplanned: false,
    };
  });

  const prescribedIdSet = new Set(prescribedViews.map((v) => v.id));
  const orphanLogs = exerciseLogs.filter(
    (log) =>
      log.trainingExerciseId === null ||
      !prescribedIdSet.has(log.trainingExerciseId),
  );
  const orphanExercises: ExerciseFormValues[] = orphanLogs.map((log) => {
    const skipped = isSkippedLog(log);
    return {
      trainingExerciseId: log.trainingExerciseId ?? "",
      exerciseId: log.exerciseId ?? undefined,
      exerciseName: displayName(log),
      prescribedName: undefined,
      isSwapped: false,
      skipped,
      notes: log.notes ?? "",
      sets: skipped ? [emptySet()] : restoreSetsFromLog(log, viewer),
      isUnplanned: true,
    };
  });

  return {
    completionQuality: sessionLog.completionQuality,
    notes: sessionLog.notes ?? "",
    exercises: [...prescribedExercises, ...orphanExercises],
  };
}
