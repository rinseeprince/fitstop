import type { LogTrainingEventInput } from "@/lib/validations/training";

/**
 * What counts as logging a workout — the one rule, shared by the client's form
 * and the server that refuses the save.
 *
 * Nothing produces a skip any more. A client who did not train logs nothing and
 * the workout reads missed once its day has passed; one who saved a log by
 * mistake clears it (`DELETE /api/client/training/events/[eventId]/log`). So a
 * save that records no work has nothing to say and is refused.
 *
 * The sources below are a LIST on purpose: a set, whatever it carries — a
 * tick alone, or any of its measures (the client's boxes tick a row the moment
 * any value is entered, and a set on the wire IS a set that was done) — and a
 * timed group's score from commit 14. Each new source joins the `some` — the
 * rule itself does not change.
 */

/** The sentence a save that records nothing is refused with. */
export const EMPTY_TRAINING_LOG_MESSAGE =
  "Tick at least one set to log this workout.";

/**
 * Thrown by the log writer when the payload records no work. Pure and
 * client-safe, like `DayLockedError`, so the form and the route say one thing.
 */
export class EmptyTrainingLogError extends Error {
  constructor() {
    super(EMPTY_TRAINING_LOG_MESSAGE);
    this.name = "EmptyTrainingLogError";
  }
}

/** The exercise shape the rule reads — the wire's, and the browser form's. */
type LoggedExercise = {
  sets: readonly unknown[];
  skipped?: boolean;
};

/**
 * Does this payload record any work?
 *
 * A payload with no `exercises` at all is the quick path: the client states the
 * outcome themselves, and the outcome can only be `full` or `partial`, so it is
 * always a log. A payload that carries exercises is judged on what they hold.
 */
export function trainingLogRecordsWork(
  payload: Pick<LogTrainingEventInput, "exercises">
): boolean {
  const exercises = payload.exercises;
  if (!Array.isArray(exercises) || exercises.length === 0) return true;
  return exercises.some(exerciseRecordsWork);
}

/** One exercise's sources of "logged": a set, whatever it carries. Commit 14 adds a score. */
function exerciseRecordsWork(exercise: LoggedExercise): boolean {
  if (exercise.skipped === true) return false;
  return exercise.sets.length > 0;
}
