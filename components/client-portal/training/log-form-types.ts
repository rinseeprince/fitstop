import type { LogTrainingEventInput } from "@/lib/validations/training";
import type { SessionCompletionQuality } from "@/types/check-in";
import type { ExerciseLog, SessionLog } from "@/types/training";
import type { PrescribedExerciseView } from "./exercise-tracker-block";
import { expandSetSpecs } from "@/utils/exercise-set-specs";
import {
  buildPrescribedRows,
  MAX_PRESCRIBED_ROWS,
  type PrescribedRow,
} from "@/utils/set-spec-rows";
import {
  summariseCompletion,
  type ScoredExercise,
} from "@/utils/completion-quality";
import { parseWeightToKg, type UnitSystem } from "@/utils/unit-conversions";
import { displayLoad } from "@/components/clients/training/program-builder/commit-input";

const UUID_RE =
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
  /**
   * "I did this set." The ONLY thing that decides completion (locked decision
   * 1): buildLogPayload sends exactly the ticked rows and nothing else, and a
   * ticked row with all three fields empty is still sent, because doing the work
   * is the claim and recording numbers is a bonus (decision 3).
   */
  completed: boolean;
};

export type ExerciseFormValues = {
  trainingExerciseId: string;
  exerciseId?: string;
  exerciseName: string;
  prescribedName?: string;
  isSwapped: boolean;
  notes: string;
  sets: SetRowValues[];
  isUnplanned: boolean;
};

// No `completionQuality`. The client no longer claims one — it is derived from
// the ticks (resolveLogOutcome) at the moment the payload is built, so a stored
// form field could only ever be a second answer to a question the ticks have
// already settled.
export type LogFormValues = {
  notes: string;
  exercises: ExerciseFormValues[];
};

export function emptySet(): SetRowValues {
  return { reps: "", weight: "", rpe: "", weightKg: null, completed: false };
}

/**
 * A prescription view flattened to the rows the client logs against.
 *
 * The ONE translation from a `PrescribedExerciseView` to `PrescribedRow[]`. The
 * renderer, the seed and the outcome line all ask this question, and a second
 * answer would put the grid's row list, the set numbers on the wire and the
 * count above the button out of step with each other.
 */
export function prescribedRowsForView(
  view: PrescribedExerciseView,
): PrescribedRow[] {
  // expandSetSpecs clamps to a floor of ONE spec, so it cannot represent
  // "nothing prescribed" — that state has to be caught before calling it or a
  // zero-set exercise grows a phantom row.
  if ((view.setSpecs?.length ?? 0) === 0 && view.sets <= 0) return [];
  return buildPrescribedRows(
    expandSetSpecs({
      setSpecs: view.setSpecs ?? null,
      sets: view.sets,
      repsMin: view.repsMin ?? null,
      repsMax: view.repsMax ?? null,
      repsTarget: view.repsTarget ?? null,
      rpeTarget: view.rpeTarget ?? null,
      restSeconds: view.restSeconds ?? null,
    }),
  );
}

/**
 * Prescriptions indexed by the form's exercise position. `null`/absent where
 * there is nothing to score against — an unplanned exercise the client added, or
 * an orphan log sitting past the prescribed prefix.
 */
export type PrescribedRowsByIndex = readonly (
  | PrescribedRow[]
  | null
  | undefined
)[];

/**
 * Pair the form's ticks with the prescription they were ticked against.
 *
 * An unplanned exercise contributes to NEITHER half, matching the server: it has
 * no prescription, so it can neither raise nor lower how much of the session was
 * completed.
 */
function scoreFormExercises(
  exercises: ExerciseFormValues[],
  prescribedRows: PrescribedRowsByIndex,
): ScoredExercise[] {
  return exercises.flatMap((ex, exerciseIndex) => {
    if (ex.isUnplanned) return [];
    const rows = prescribedRows[exerciseIndex];
    if (!rows) return [];
    return [
      {
        prescribedRows: rows,
        completedSetNumbers: ex.sets.flatMap((set, setIndex) =>
          set.completed ? [setIndex + 1] : [],
        ),
      },
    ];
  });
}

type LogOutcome = {
  completedWorkingSets: number;
  prescribedWorkingSets: number;
  quality: SessionCompletionQuality;
};

/**
 * What this form will be recorded as, and the count that explains it.
 *
 * ONE function, because the sentence above the button ("9 of 12 working sets
 * logged. Will be recorded as partial.") is a promise about the value
 * buildLogPayload puts on the wire. Two derivations could disagree, and the
 * client would be the one telling the lie.
 *
 * The fallback covers a session with nothing scorable prescribed — no exercises
 * at all, or only warm-ups. `summariseCompletion` returns null there, and the
 * server does the same and defers to this value, so it has to be decided
 * somewhere: a client who ticked anything did everything there was to do
 * (`full`), one who ticked nothing skipped it.
 */
export function resolveLogOutcome(
  exercises: ExerciseFormValues[],
  prescribedRows: PrescribedRowsByIndex,
): LogOutcome {
  const summary = summariseCompletion(
    scoreFormExercises(exercises, prescribedRows),
  );
  const quality =
    summary.quality ??
    (exercises.some((ex) => ex.sets.some((set) => set.completed))
      ? "full"
      : "skipped");
  return {
    completedWorkingSets: summary.completedWorkingSets,
    prescribedWorkingSets: summary.prescribedWorkingSets,
    quality,
  };
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
  prescribedRows: PrescribedRowsByIndex,
): LogTrainingEventInput {
  const detailed = values.exercises
    .map((ex, exIndex) => {
      // Exactly the ticked sets. The tick is the claim; an unticked row says
      // "not done" and is simply absent from the wire (there is no `completed`
      // flag on the schema — presence IS completion).
      const completedSets = ex.sets.flatMap((s, setIndex) =>
        s.completed
          ? [
              {
                // The row's position in THIS form's row list, which mirrors the
                // flattened prescription (seedDefaultValues builds it from
                // buildPrescribedRows and restores a log back into the same
                // shape, and a prescribed row cannot be deleted). The server
                // reads it as an index into that list — prescribedRows[n - 1] —
                // to stamp the coach-prescribed set_type.
                //
                // It is taken from the ORIGINAL array, never from a position
                // among the selected rows: numbering after selecting renumbered
                // a logged subset down to 1..n, so a lone working set was stored
                // as set 1 and typed from the warm-up spec.
                setNumber: setIndex + 1,
                reps: s.reps.trim() ? Number(s.reps) : undefined,
                weight: isWeightDirty(exIndex, setIndex)
                  ? s.weight.trim()
                    ? parseWeightToKg(Number(s.weight), viewer)
                    : undefined
                  : (s.weightKg ?? undefined),
                rpe: s.rpe.trim() ? Number(s.rpe) : undefined,
              },
            ]
          : [],
      );

      if (completedSets.length === 0) return null;

      const trimmedNotes = ex.notes.trim();
      return {
        ...(UUID_RE.test(ex.trainingExerciseId) && {
          trainingExerciseId: ex.trainingExerciseId,
        }),
        ...(ex.exerciseId &&
          UUID_RE.test(ex.exerciseId) && { exerciseId: ex.exerciseId }),
        exerciseName: ex.exerciseName,
        sets: completedSets,
        // Already canonical — see the note above.
        weightUnit: "kg" as const,
        ...(trimmedNotes && { notes: trimmedNotes }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const trimmedNotes = values.notes.trim();
  const base: LogTrainingEventInput = {
    // The client no longer selects this. The server ignores it whenever the
    // payload carries `exercises` and derives its own (Phase 1), but the field
    // is required by the schema and IS honoured for an exercise-less payload —
    // so sending the outcome the client was shown keeps the two agreeing on the
    // one path where the client's value still decides.
    completionQuality: resolveLogOutcome(values.exercises, prescribedRows)
      .quality,
    ...(trimmedNotes && { notes: trimmedNotes }),
  };
  return detailed.length > 0 ? { ...base, exercises: detailed } : base;
}

/** `count` empty, unticked rows — never fewer than one to type into. */
function blankRows(count: number): SetRowValues[] {
  return Array.from({ length: Math.max(1, count) }, () => emptySet());
}

/**
 * Rebuild the FULL row list for a logged exercise, with the logged sets dropped
 * back onto the rows they were logged against and ticked.
 *
 * The row list is the prescription, not the log. Rebuilding only the logged rows
 * is what made a session logged as sets 3-5 of six reopen as a three-row form
 * and re-save as 1-3 — the same shape of bug as the one this workstream exists
 * to fix, a form sized from an assumption and silently renumbering what didn't
 * fit.
 *
 * The list is sized to hold BOTH ends: the prescription, and the highest set
 * number actually logged. A logged set past the prescription is real and
 * reachable — the client appended rows of their own, or the coach shrank the
 * prescription afterwards — and dropping it would not merely hide it. The write
 * path full-replaces (every exercise_log deleted, set_logs cascaded, re-inserted
 * from the payload), so a row missing from the rebuilt form is deleted from the
 * database on the next save. Reopen, save, gone.
 */
function restoreSetsFromLog(
  log: ExerciseLog,
  viewer: UnitSystem,
  prescribedRowCount: number,
): SetRowValues[] {
  const highestLogged = log.sets.reduce(
    (max, s) => (Number.isInteger(s.setNumber) && s.setNumber > max ? s.setNumber : max),
    0,
  );
  // MAX_PRESCRIBED_ROWS is the wire's own bound on setNumber, so it cannot
  // truncate anything this form could ever send back. It is here so a corrupt
  // stored set_number cannot ask the browser for a billion-row array.
  const rows = blankRows(
    Math.min(Math.max(prescribedRowCount, highestLogged), MAX_PRESCRIBED_ROWS),
  );

  for (const s of log.sets) {
    const index = s.setNumber - 1;
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) continue;
    rows[index] = {
      reps: s.reps != null ? String(s.reps) : "",
      // Unsnapped, never formatLoad: this seeds an editable field, and a snap
      // would round-trip into the logged value.
      weight: displayLoad(s.weight, viewer),
      rpe: s.rpe != null ? String(s.rpe) : "",
      weightKg: s.weight ?? null,
      // It was logged, so it was done. Reopening a session shows the whole
      // prescription with exactly the logged rows banked.
      completed: true,
    };
  }
  return rows;
}

function displayName(log: ExerciseLog): string {
  return (
    log.performedName ??
    (log.prescribedExerciseSnapshot?.name as string | undefined) ??
    "Unplanned exercise"
  );
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
      notes: "",
      exercises: prescribedViews.map((v) => ({
        trainingExerciseId: v.id,
        exerciseId: undefined,
        exerciseName: v.name,
        prescribedName: v.name,
        isSwapped: false,
        notes: "",
        // Flattened, so a drop set contributes its top set PLUS one row per drop
        // — the same expansion training-log-service uses when it stamps
        // set_type. The two must agree or every row after a drop set is typed
        // from the wrong spec.
        sets: blankRows(prescribedRowsForView(v).length),
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
    const rowCount = prescribedRowsForView(v).length;
    const log = logsByExerciseId.get(v.id);
    if (!log) {
      return {
        trainingExerciseId: v.id,
        exerciseId: undefined,
        exerciseName: v.name,
        prescribedName: v.name,
        isSwapped: false,
        notes: "",
        sets: blankRows(rowCount),
        isUnplanned: false,
      };
    }
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
      notes: log.notes ?? "",
      sets: restoreSetsFromLog(log, viewer, rowCount),
      isUnplanned: false,
    };
  });

  const prescribedIdSet = new Set(prescribedViews.map((v) => v.id));
  const orphanLogs = exerciseLogs.filter(
    (log) =>
      log.trainingExerciseId === null ||
      !prescribedIdSet.has(log.trainingExerciseId),
  );
  const orphanExercises: ExerciseFormValues[] = orphanLogs.map((log) => ({
    trainingExerciseId: log.trainingExerciseId ?? "",
    exerciseId: log.exerciseId ?? undefined,
    exerciseName: displayName(log),
    prescribedName: undefined,
    isSwapped: false,
    notes: log.notes ?? "",
    // Nothing prescribed, so the logged sets alone size the list.
    sets: restoreSetsFromLog(log, viewer, 0),
    isUnplanned: true,
  }));

  return {
    notes: sessionLog.notes ?? "",
    exercises: [...prescribedExercises, ...orphanExercises],
  };
}
