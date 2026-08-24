import type { SessionCompletionQuality } from "@/types/check-in";
import type { PrescribedRow } from "./set-spec-rows";

// How much of a prescribed session the client completed.
//
// A tick is the only thing that decides completion (locked decision 1), so this
// counts SETS SENT, never sets with numbers in them: a set the client did but
// recorded nothing for still counts. Warm-ups are recorded but never scored
// (decision 5) — they are excluded from both halves of the ratio.
//
// It lives in utils/ rather than inside the write path because the client's
// pre-commit outcome line ("9 of 12 working sets logged") has to agree with what
// the coach's adherence number ends up saying. Two implementations would let
// them disagree, and the client would be the one telling the lie.

export type ScoredExercise = {
  /**
   * The exercise's flattened prescription (`buildPrescribedRows` output).
   *
   * An exercise with no non-warmup row is skipped entirely — it has nothing to
   * be complete against — which is why an empty list is tolerated rather than
   * rejected. No caller builds one today: an unplanned exercise has no
   * prescription and is dropped before this array is assembled.
   */
  prescribedRows: PrescribedRow[];
  /** 1-based flattened set numbers the client says it completed. */
  completedSetNumbers: number[];
};

/**
 * Resolve a session's completion quality from its prescription and the sets the
 * client sent.
 *
 * Every prescribed working set, on EVERY exercise, is what `full` means (locked
 * decision 4). That is why each exercise is judged against its own prescription
 * and the verdicts combined, rather than one session-wide ratio: no exercise is
 * ever measured against another's total, so a surplus on one cannot mask a
 * deficit on another. (The dedupe and the existence check below separately keep
 * `completed` at most `prescribed` per exercise, but nothing here depends on
 * that — `completed < prescribed` is a statement about one exercise alone.)
 *
 * Returns null when nothing prescribed is scorable, so the caller can fall back
 * to the client's own claim rather than report `skipped` for a session that
 * prescribed nothing measurable.
 */
export function deriveCompletionQuality(
  exercises: ScoredExercise[],
): SessionCompletionQuality | null {
  let scorable = 0;
  let anyCompleted = false;
  let allComplete = true;

  for (const exercise of exercises) {
    const prescribed = exercise.prescribedRows.filter(
      (row) => row.setType !== "warmup",
    ).length;
    if (prescribed === 0) continue;
    scorable += 1;

    // Distinct set numbers landing on a non-warmup row of THIS exercise. A set
    // number with no row behind it (the coach shrank the prescription after the
    // client logged it) is not a prescribed working set and scores nothing.
    let completed = 0;
    for (const setNumber of new Set(exercise.completedSetNumbers)) {
      const row = exercise.prescribedRows[setNumber - 1];
      if (row && row.setType !== "warmup") completed += 1;
    }

    if (completed > 0) anyCompleted = true;
    if (completed < prescribed) allComplete = false;
  }

  if (scorable === 0) return null;
  if (!anyCompleted) return "skipped";
  return allComplete ? "full" : "partial";
}
