/**
 * Epley formula: estimates 1RM from a set's weight and reps.
 * For 1-rep sets, e1RM equals the weight (no extrapolation needed).
 * Returns null for invalid inputs.
 *
 * Identity-union resolution (formerly resolveExerciseIdentityKey /
 * exerciseLogMatchesTarget) now lives in SQL — see the get_client_exercise_list /
 * get_exercise_progression_window / get_exercise_prs RPCs in migration 094.
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
 * The estimated 1RM a coach reads: Epley, to a tenth. The Sessions table's
 * e1RM (the best of a session's lifts) and the All exercises table's Best e1RM
 * (the best of an exercise's rep maxes, get_client_exercise_bests) are this
 * one number, so the two tables never read one set two ways.
 */
export function estimateOneRepMax(weight: number, reps: number): number | null {
  const e1rm = calculateEpleyE1RM(weight, reps);
  return e1rm == null ? null : Math.round(e1rm * 10) / 10;
}
