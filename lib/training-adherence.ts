import { loggedDisplayQuality, type TrainingWorkoutRead } from "@/lib/training-display-state";

/**
 * How ONE workout counts towards adherence, from the quality on its log
 * (`lib/training-display-state.ts` — the event says whether the client logged
 * it, the log says how it went).
 *
 * Three buckets, not five: a workout still to be done and one the client never
 * did are the same thing to a count, and an empty log ("skipped") is not a
 * workout done. Only `missed` merges states; `full` and `partial` are exactly
 * the log's own words.
 */
export type TrainingAdherenceStatus = "full" | "partial" | "missed";

export function trainingAdherenceStatus(
  workout: TrainingWorkoutRead
): TrainingAdherenceStatus {
  const quality = loggedDisplayQuality(workout);
  if (quality === "full") return "full";
  if (quality === "partial") return "partial";
  return "missed";
}

/**
 * A window's training, counted once.
 *
 * `completed` is `full + partial` — a partial workout was still done against
 * the prescription — and `full` / `partial` / `missed` are the breakdown
 * printed beside it. `pct` is `completed / planned`, and `null` (not 0) when
 * nothing was planned, so a surface can say "no sessions prescribed" rather
 * than 0%.
 */
export type TrainingAdherence = {
  /** Every calendar workout in the window. */
  planned: number;
  /** `full + partial`. */
  completed: number;
  full: number;
  partial: number;
  /** Not done: skipped, still scheduled, or never logged. */
  missed: number;
  /** `completed / planned` as a percentage; null when nothing was planned. */
  pct: number | null;
};

/**
 * The ONE training-adherence summariser, over any rows carrying a workout's
 * status and its log's quality — calendar events, or the per-workout detail a
 * check-in read carries.
 *
 * It is the single definition behind every training figure a check-in shows:
 * the coach review's KPI ribbon and AI prompt read `completed`, and the
 * client's wizard and the stored `check_ins.workouts_completed` read `full`.
 * Before it there were three counts over the same rows, and one week read 4/5
 * on the client's check-in and 5/5 on the coach's review.
 */
export function summariseTraining(
  workouts: readonly TrainingWorkoutRead[]
): TrainingAdherence {
  let full = 0;
  let partial = 0;
  let missed = 0;
  for (const workout of workouts) {
    const status = trainingAdherenceStatus(workout);
    if (status === "full") full += 1;
    else if (status === "partial") partial += 1;
    else missed += 1;
  }
  const planned = workouts.length;
  const completed = full + partial;
  return {
    planned,
    completed,
    full,
    partial,
    missed,
    pct: planned > 0 ? Math.round((completed / planned) * 100) : null,
  };
}
