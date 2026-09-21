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
