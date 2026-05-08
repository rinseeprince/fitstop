/**
 * Epley formula: estimates 1RM from a set's weight and reps.
 * For 1-rep sets, e1RM equals the weight (no extrapolation needed).
 * Returns null for invalid inputs.
 */
export function calculateEpleyE1RM(
  weight: number,
  reps: number
): number | null {
  if (weight <= 0 || reps <= 0 || reps > 30) return null;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Resolves the grouping key for an exercise log, implementing:
 * COALESCE(exercise_logs.exercise_id, training_exercises.exercise_id, LOWER(performed_name))
 */
export function resolveExerciseIdentityKey(
  exerciseLogExerciseId: string | null,
  trainingExerciseExerciseId: string | null,
  performedName: string | null
): string {
  return (
    exerciseLogExerciseId ??
    trainingExerciseExerciseId ??
    performedName?.toLowerCase() ??
    "unknown"
  );
}

/**
 * Checks whether an exercise log matches a target exercise via the dual
 * identity path (direct exercise_id on exercise_log, or via training_exercises)
 * plus a name-based fallback for legacy rows.
 */
export function exerciseLogMatchesTarget(
  log: {
    exerciseId: string | null;
    trainingExerciseExerciseId: string | null;
    performedName: string | null;
  },
  target: { exerciseId?: string; exerciseName?: string }
): boolean {
  if (target.exerciseId) {
    if (log.exerciseId === target.exerciseId) return true;
    if (log.trainingExerciseExerciseId === target.exerciseId) return true;
  }
  if (target.exerciseName && log.performedName) {
    if (log.performedName.toLowerCase() === target.exerciseName.toLowerCase())
      return true;
  }
  return false;
}
