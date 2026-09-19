import type { GroupFormat } from "./exercise-groups";
import { SET_LOG_MEASURES } from "./set-log-measures";

// A timed group's score (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md sections 4.2
// and 4.5; migration 186). Pure and client-safe: the wire schema, the log
// writer, the client's score boxes and the coach's readout all ask this module
// which groups score and what shape a score takes, and the migration test
// reads the bounds against migration 186's CHECKs.
//
// - An AMRAP scores rounds plus extra reps.
// - A For time scores its finish time, or the rounds and reps reached when
//   the time cap ran out - so the SHAPE says whether it was capped.
// - An EMOM takes no score: it logs its rows like any round-based group
//   (owner, 2026-09-19). Straight sets and a superset or circuit never score.

/** The formats whose groups run on a clock: a timer, and for two of them a score. */
export function isTimedFormat(format: GroupFormat): boolean {
  return format === "amrap" || format === "emom" || format === "for_time";
}

/** The formats that take a score. */
export function takesScore(format: GroupFormat): format is "amrap" | "for_time" {
  return format === "amrap" || format === "for_time";
}

// Bounds, mirrored by migration 186's CHECKs. A finish time is a duration:
// the same limit and scale as a logged set's duration.
export const GROUP_SCORE_ROUNDS_MAX = 1000;
export const GROUP_SCORE_REPS_MAX = 1000;
export const GROUP_SCORE_FINISH_SECONDS_MIN = SET_LOG_MEASURES.duration.floor;
export const GROUP_SCORE_FINISH_SECONDS_MAX = SET_LOG_MEASURES.duration.ceiling;
export const GROUP_SCORE_FINISH_SCALE = SET_LOG_MEASURES.duration.scale;

/** A score as it travels and as it is stored: rounds and reps together, or a finish time alone. */
export type GroupScoreValue =
  | { rounds: number; reps: number; finishSeconds: null }
  | { rounds: null; reps: null; finishSeconds: number };

/** A score before its shape is judged: any of the three, each possibly absent. */
type GroupScoreFields = {
  rounds?: number | null;
  reps?: number | null;
  finishSeconds?: number | null;
};

/** The sentences a score is refused with; the wire schema and the writer say the same words. */
export const GROUP_SCORE_MESSAGES = {
  notScored: "Only an AMRAP or For time group takes a score.",
  amrapShape: "An AMRAP's score is rounds and reps.",
  shape: "A score is a finish time, or rounds and reps.",
} as const;

/**
 * Why `score` is not a score `format` can take, or null when it is. The one
 * rule: only an AMRAP or a For time scores; a finish time alone or rounds and
 * reps together, never a mix; and an AMRAP's is always rounds and reps.
 */
export function groupScoreIssue(format: GroupFormat, score: GroupScoreFields): string | null {
  if (!takesScore(format)) return GROUP_SCORE_MESSAGES.notScored;
  const shape = groupScoreValue(score);
  if (shape === null) return GROUP_SCORE_MESSAGES.shape;
  if (format === "amrap" && shape.finishSeconds !== null) return GROUP_SCORE_MESSAGES.amrapShape;
  return null;
}

/** `fields` as one of the two shapes, or null when they are neither. */
export function groupScoreValue(fields: GroupScoreFields): GroupScoreValue | null {
  const rounds = fields.rounds ?? null;
  const reps = fields.reps ?? null;
  const finishSeconds = fields.finishSeconds ?? null;
  if (finishSeconds !== null && rounds === null && reps === null) {
    return { rounds: null, reps: null, finishSeconds };
  }
  if (finishSeconds === null && rounds !== null && reps !== null) {
    return { rounds, reps, finishSeconds: null };
  }
  return null;
}
