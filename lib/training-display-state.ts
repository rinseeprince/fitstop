import type { LoggedQuality } from "@/types/training";

/**
 * What a screen shows for ONE calendar workout, and the only vocabulary a tick,
 * a dash, a chip or a pill may key on.
 *
 * Two facts decide it, and they live in two different places:
 *
 * - **Did the client log this workout?** `training_events.status` answers that
 *   and nothing else — `completed` is logged, at any quality.
 * - **How did it go?** `session_logs.completion_quality` answers that, on the
 *   log alone. No screen reads the quality off the status word — that copy is
 *   what made the same week read 4/5 on one page and 5/5 on the next.
 *
 * `missed` is derived, never stored: a workout still scheduled on a day that
 * has passed. Which day has passed is the caller's `today`, on the calendar the
 * surface belongs to (the client's for their own screens, the coach's for the
 * coach's).
 *
 * There is no skipped state. A save with nothing logged is refused
 * (`lib/training-log-content.ts`), and "I did not do this after all" is Clear
 * log, which puts the workout back to `scheduled` with nothing recorded.
 */
export type TrainingDisplayState =
  | "scheduled"
  | "completed_full"
  | "completed_partial"
  | "missed";

/** A calendar workout as a display reads it: its attendance word and its log's quality. */
export type TrainingWorkoutRead = {
  /** `training_events.status` — whether the client has logged this workout. */
  status: string;
  /** `session_logs.completion_quality` through the linked log; null when none is linked. */
  completionQuality: LoggedQuality | null;
};

/**
 * The two facts as a calendar event carries them — its status, and the quality
 * on the log embedded beside it.
 */
export function eventWorkoutRead(event: {
  status: string;
  log: { completionQuality: LoggedQuality } | null;
}): TrainingWorkoutRead {
  return {
    status: event.status,
    completionQuality: event.log?.completionQuality ?? null,
  };
}

/**
 * The quality to display for a workout, or `null` when the client has not
 * logged it.
 *
 * The log is the answer whenever it carries one of the two words the product
 * writes. A workout the event says was logged but that carries no quality reads
 * `full`: those rows (227 on dev in September 2026) were logged before the link
 * existed, so their quality was never recorded, and "completed at a quality
 * nobody wrote down" is a full workout, not a missing one.
 *
 * The status is read POSITIVELY — logged is `completed` — rather than as
 * "anything but scheduled", so a database read before migration 182 lands still
 * answers truthfully: a word the product no longer stores is not a workout done.
 */
export function loggedDisplayQuality(
  workout: TrainingWorkoutRead
): LoggedQuality | null {
  if (workout.completionQuality === "full" || workout.completionQuality === "partial") {
    return workout.completionQuality;
  }
  return workout.status === "completed" ? "full" : null;
}

/**
 * One workout's display state. `today` is the day the surface's own calendar is
 * on: a still-scheduled workout dated before it was missed, and one dated today
 * or later is still to be done.
 */
export function trainingDisplayState(
  workout: TrainingWorkoutRead & { date: string },
  today: string
): TrainingDisplayState {
  const quality = loggedDisplayQuality(workout);
  if (quality === "full") return "completed_full";
  if (quality === "partial") return "completed_partial";
  return workout.date < today ? "missed" : "scheduled";
}
