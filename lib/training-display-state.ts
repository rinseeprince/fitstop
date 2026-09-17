import type { SessionCompletionQuality } from "@/types/check-in";

/**
 * What a screen shows for ONE calendar workout, and the only vocabulary a tick,
 * a dash, a chip or a pill may key on.
 *
 * Two facts decide it, and they live in two different places:
 *
 * - **Did the client log this workout?** `training_events.status` answers that
 *   and nothing else. A workout that has left `scheduled` is logged.
 * - **How did it go?** `session_logs.completion_quality` answers that, on the
 *   log alone. No screen reads the quality off the status word — that copy is
 *   what made the same week read 4/5 on one page and 5/5 on the next.
 *
 * `missed` is derived, never stored: a workout still scheduled on a day that
 * has passed. Which day has passed is the caller's `today`, on the calendar the
 * surface belongs to (the client's for their own screens, the coach's for the
 * coach's).
 */
export type TrainingDisplayState =
  | "scheduled"
  | "completed_full"
  | "completed_partial"
  | "skipped"
  | "missed";

/** A calendar workout as a display reads it: its attendance word and its log's quality. */
type TrainingWorkoutRead = {
  /** `training_events.status` — whether the client has logged this workout. */
  status: string;
  /** `session_logs.completion_quality` through the linked log; null when none is linked. */
  completionQuality: SessionCompletionQuality | null;
};

/**
 * The two facts as a calendar event carries them — its status, and the quality
 * on the log embedded beside it.
 */
export function eventWorkoutRead(event: {
  status: string;
  log: { completionQuality: SessionCompletionQuality } | null;
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
 * The log is the answer whenever there is one. A workout that left `scheduled`
 * with no log reads `full`: those rows (209 on dev in September 2026) were
 * logged before the link existed, so their quality was never recorded, and
 * "completed at a quality nobody wrote down" is a full workout, not a missing
 * one. `skipped` is the one status word that stands on its own — an empty log
 * is not a completed workout — and it leaves the product in commit 9.
 */
export function loggedDisplayQuality(
  workout: TrainingWorkoutRead
): SessionCompletionQuality | null {
  if (workout.completionQuality !== null) return workout.completionQuality;
  if (workout.status === "skipped") return "skipped";
  if (workout.status === "scheduled" || workout.status === "missed") return null;
  return "full";
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
  if (quality === "skipped") return "skipped";
  return workout.status === "missed" || workout.date < today ? "missed" : "scheduled";
}
