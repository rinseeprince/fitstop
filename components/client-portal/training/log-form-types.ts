import type { LogTrainingEventInput } from "@/lib/validations/training";
import type { ExerciseLog, SessionLog } from "@/types/training";
import type { PrescribedExerciseView } from "./exercise-tracker-block";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetRowValues = { reps: string; weight: string; rpe: string };

export type ExerciseFormValues = {
  trainingExerciseId: string;
  exerciseName: string;
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

// Restoration is best-effort and lossy. exercise_logs.actual_weight stores
// only the top set's weight, so the same weight is shown on every set row.
// RPE is not persisted in exercise_logs and cannot be restored.
function restoreSetsFromLog(
  log: ExerciseLog,
  prescribedSetsCount: number,
): SetRowValues[] {
  if (log.completed === false && log.actualSets === null) {
    return [emptySet()];
  }
  const reps = log.actualReps
    ? log.actualReps.split(",").map((r) => r.trim()).filter(Boolean)
    : [];
  const weight = log.actualWeight != null ? String(log.actualWeight) : "";
  if (reps.length === 0) {
    return Array.from({ length: Math.max(1, prescribedSetsCount) }, () =>
      emptySet(),
    );
  }
  return reps.map((r) => ({ reps: r, weight, rpe: "" }));
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
        exerciseName: v.name,
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
        exerciseName: v.name,
        weightUnit,
        skipped: false,
        notes: "",
        sets: Array.from({ length: Math.max(1, v.sets) }, () => emptySet()),
        isUnplanned: false,
      };
    }
    const skipped = log.completed === false && log.actualSets === null;
    return {
      trainingExerciseId: v.id,
      exerciseName: v.name,
      weightUnit: log.weightUnit ?? weightUnit,
      skipped,
      notes: log.notes ?? "",
      sets: skipped ? [emptySet()] : restoreSetsFromLog(log, v.sets),
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
    const skipped = log.completed === false && log.actualSets === null;
    const snapshotName =
      (log.prescribedExerciseSnapshot?.name as string | undefined) ??
      "Unplanned exercise";
    return {
      trainingExerciseId: log.trainingExerciseId ?? "",
      exerciseName: snapshotName,
      weightUnit: log.weightUnit ?? weightUnit,
      skipped,
      notes: log.notes ?? "",
      sets: skipped ? [emptySet()] : restoreSetsFromLog(log, 1),
      isUnplanned: true,
    };
  });

  return {
    completionQuality: sessionLog.completionQuality,
    notes: sessionLog.notes ?? "",
    exercises: [...prescribedExercises, ...orphanExercises],
  };
}
