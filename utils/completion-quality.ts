import type { LoggedQuality } from "@/types/training";
import type { PrescribedRow } from "./set-spec-rows";

// How much of a prescribed session the client completed.
//
// A tick is the only thing that decides an exercise's completion (locked
// decision 1), so this counts SETS SENT, never sets with numbers in them: a set
// the client did but recorded nothing for still counts. Warm-ups are recorded
// but never scored (decision 5) — they are excluded from both halves of the
// ratio.
//
// A timed group that takes a score — an AMRAP or a For time — is done by its
// SCORE (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.5; owner,
// 2026-09-19): an AMRAP is done once its score is entered; a For time is done
// in full when a finish time is entered, and a capped one — rounds and reps,
// the cap having run out — is partial, because the prescribed work was not all
// done; one left unscored is partial whatever its rows say. Its exercises' rows
// are optional detail and are not among the exercises scored here. An EMOM
// takes no score and its rows count like a circuit's.
//
// It scores a session that recorded SOMETHING: a save with nothing logged is
// refused before it gets here (`lib/training-log-content.ts`), so the verdict
// is full or partial and never a skip.
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
 * A group that takes a score, as the verdict reads it: whether a score was
 * entered, and for a For time whether it was the capped shape — rounds and
 * reps, the cap having run out — rather than a finish time.
 */
export type ScoredGroup = {
  format: "amrap" | "for_time";
  scored: boolean;
  capped: boolean;
};

/** Done in full: scored, and a For time finished rather than capped. */
export function isGroupComplete(group: ScoredGroup): boolean {
  return group.scored && !(group.format === "for_time" && group.capped);
}

type CompletionSummary = {
  /** Non-warmup sets the client says it completed, across the whole session. */
  completedWorkingSets: number;
  /** Non-warmup sets prescribed, across the whole session. */
  prescribedWorkingSets: number;
  /** The groups that take a score, how many hold one, and how many For times were capped. */
  scoringGroups: number;
  scoredGroups: number;
  cappedGroups: number;
  /**
   * The verdict. Null when nothing prescribed is scorable, so the caller can
   * fall back to the client's own claim rather than judge a session that
   * prescribed nothing measurable.
   */
  quality: LoggedQuality | null;
};

/**
 * Score a session in one pass: the counts the client is shown before committing
 * ("2 of 2 groups scored · 9 of 12 working sets logged") and the verdict that
 * reaches the coach.
 *
 * One traversal because the two must not be able to disagree — the sentence
 * above the client's button is a promise about the number the coach will see.
 *
 * **The two halves are computed differently, deliberately.** The VERDICT is
 * per-exercise and per-group: every prescribed working set, on EVERY exercise,
 * and every scoring group done (`isGroupComplete`) is what `full` means (locked
 * decision 4), so each exercise is judged against its own prescription and the
 * verdicts combined. No exercise is ever measured against another's total, so a
 * surplus on one cannot mask a deficit on another. The COUNTS are a
 * session-wide display sum, because "9 of 12" is the only shape that sentence
 * can take.
 *
 * They cannot contradict each other today, and the reason is worth naming: the
 * dedupe and the existence check below cap `completed` at `prescribed` PER
 * EXERCISE, so the sums can only meet when every exercise is individually
 * complete. Lift that cap — count a set twice, or score a set number with no
 * prescribed row behind it — and the outcome line starts reading "12 of 12
 * working sets logged. Will be recorded as partial." The verdict would still be
 * right; the sentence explaining it would not. A capped For time is the one
 * case where the counts read complete and the verdict does not, so the sentence
 * names it ("1 group capped").
 */
export function summariseCompletion(
  exercises: ScoredExercise[],
  groups: readonly ScoredGroup[] = [],
): CompletionSummary {
  let scorable = 0;
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

    if (completed < prescribed) allComplete = false;
  }

  let scoredGroups = 0;
  let cappedGroups = 0;
  for (const group of groups) {
    scorable += 1;
    if (group.scored) scoredGroups += 1;
    if (group.scored && group.format === "for_time" && group.capped) cappedGroups += 1;
    if (!isGroupComplete(group)) allComplete = false;
  }

  // Partial covers everything short of complete, a session whose only ticks
  // landed on warm-ups included: the client did some of this workout, and the
  // save would have been refused if they had done none of it.
  const quality: LoggedQuality | null =
    scorable === 0 ? null : allComplete ? "full" : "partial";

  return {
    completedWorkingSets,
    prescribedWorkingSets,
    scoringGroups: groups.length,
    scoredGroups,
    cappedGroups,
    quality,
  };
}

/**
 * The verdict alone — the server write path's entry point, which has no use for
 * the counts. A thin wrapper rather than a second implementation so the client's
 * outcome line and the coach's adherence number cannot drift apart.
 */
export function deriveCompletionQuality(
  exercises: ScoredExercise[],
  groups: readonly ScoredGroup[] = [],
): LoggedQuality | null {
  return summariseCompletion(exercises, groups).quality;
}
