import type { LogTrainingEventInput } from "@/lib/validations/training";
import type { ExerciseLog, SessionLog } from "@/types/training";
import type { PrescribedExerciseView } from "./exercise-tracker-block";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetRowValues = { reps: string; weight: string; rpe: string };

export type ExerciseFormValues = {
  trainingExerciseId: string;
  exerciseId?: string;
  exerciseName: string;
  prescribedName?: string;
  isSwapped: boolean;
  weightUnit: "lbs" | "kg";
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
  return { reps: "", weight: "", rpe: "" };
}

export function buildLogPayload(
  values: LogFormValues,
): LogTrainingEventInput {
  const detailed = values.exercises
    .map((ex) => {
      const filledSets = ex.sets
        .map((s) => ({
          reps: s.reps.trim() ? Number(s.reps) : undefined,
          weight: s.weight.trim() ? Number(s.weight) : undefined,
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
        weightUnit: ex.weightUnit,
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
function restoreSetsFromLog(log: ExerciseLog): SetRowValues[] {
  if (log.sets.length === 0) return [emptySet()];
  return [...log.sets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => ({
      reps: s.reps != null ? String(s.reps) : "",
      weight: s.weight != null ? String(s.weight) : "",
      rpe: s.rpe != null ? String(s.rpe) : "",
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

export function seedDefaultValues(args: {
  prescribedViews: PrescribedExerciseView[];
  sessionLog: SessionLog | null;
  exerciseLogs: ExerciseLog[];
  weightUnit: "lbs" | "kg";
}): LogFormValues {
  const { prescribedViews, sessionLog, exerciseLogs, weightUnit } = args;

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
        weightUnit,
        skipped: false,
        notes: "",
        sets: Array.from({ length: Math.max(1, v.sets) }, () => emptySet()),
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
        weightUnit,
        skipped: false,
        notes: "",
        sets: Array.from({ length: Math.max(1, v.sets) }, () => emptySet()),
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
      weightUnit: log.weightUnit ?? weightUnit,
      skipped,
      notes: log.notes ?? "",
      sets: skipped ? [emptySet()] : restoreSetsFromLog(log),
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
      weightUnit: log.weightUnit ?? weightUnit,
      skipped,
      notes: log.notes ?? "",
      sets: skipped ? [emptySet()] : restoreSetsFromLog(log),
      isUnplanned: true,
    };
  });

  return {
    completionQuality: sessionLog.completionQuality,
    notes: sessionLog.notes ?? "",
    exercises: [...prescribedExercises, ...orphanExercises],
  };
}
