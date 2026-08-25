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

type CompletionSummary = {
  /** Non-warmup sets the client says it completed, across the whole session. */
  completedWorkingSets: number;
  /** Non-warmup sets prescribed, across the whole session. */
  prescribedWorkingSets: number;
  /**
   * The verdict. Null when nothing prescribed is scorable, so the caller can
   * fall back to the client's own claim rather than report `skipped` for a
   * session that prescribed nothing measurable.
   */
  quality: SessionCompletionQuality | null;
};

/**
 * Score a session in one pass: the counts the client is shown before committing
 * ("9 of 12 working sets logged") and the verdict that reaches the coach.
 *
 * One traversal because the two must not be able to disagree — the sentence
 * above the client's button is a promise about the number the coach will see.
 *
 * **The two halves are computed differently, deliberately.** The VERDICT is
 * per-exercise: every prescribed working set, on EVERY exercise, is what `full`
 * means (locked decision 4), so each exercise is judged against its own
 * prescription and the verdicts combined. No exercise is ever measured against
 * another's total, so a surplus on one cannot mask a deficit on another. The
 * COUNTS are a session-wide display sum, because "9 of 12" is the only shape
 * that sentence can take.
 *
 * They cannot contradict each other today, and the reason is worth naming: the
 * dedupe and the existence check below cap `completed` at `prescribed` PER
 * EXERCISE, so the sums can only meet when every exercise is individually
 * complete. Lift that cap — count a set twice, or score a set number with no
 * prescribed row behind it — and the outcome line starts reading "12 of 12
 * working sets logged. Will be recorded as partial." The verdict would still be
 * right; the sentence explaining it would not.
 */
export function summariseCompletion(
  exercises: ScoredExercise[],
): CompletionSummary {
  let scorable = 0;
  let anyCompleted = false;
  let allComplete = true;
  let completedWorkingSets = 0;
  let prescribedWorkingSets = 0;

  for (const exercise of exercises) {
    const prescribed = exercise.prescribedRows.filter(
      (row) => row.setType !== "warmup",
    ).length;
    if (prescribed === 0) continue;
    scorable += 1;
    prescribedWorkingSets += prescribed;

    // Distinct set numbers landing on a non-warmup row of THIS exercise. A set
    // number with no row behind it (the coach shrank the prescription after the
    // client logged it) is not a prescribed working set and scores nothing.
    let completed = 0;
    for (const setNumber of new Set(exercise.completedSetNumbers)) {
      const row = exercise.prescribedRows[setNumber - 1];
      if (row && row.setType !== "warmup") completed += 1;
    }
    completedWorkingSets += completed;

    if (completed > 0) anyCompleted = true;
    if (completed < prescribed) allComplete = false;
  }

  const quality =
    scorable === 0
      ? null
      : !anyCompleted
        ? "skipped"
        : allComplete
          ? "full"
          : "partial";

  return { completedWorkingSets, prescribedWorkingSets, quality };
}

/**
 * The verdict alone — the server write path's entry point, which has no use for
 * the counts. A thin wrapper rather than a second implementation so the client's
 * outcome line and the coach's adherence number cannot drift apart.
 */
export function deriveCompletionQuality(
  exercises: ScoredExercise[],
): SessionCompletionQuality | null {
  return summariseCompletion(exercises).quality;
}
