import type { TrainingEvent } from "@/types/training";
import type { ScheduleDay, TrainingDayStatus } from "@/types/schedule";
import { DAY_NAMES } from "@/lib/date-helpers";
import {
  eventWorkoutRead,
  trainingDisplayState,
  type TrainingDisplayState,
} from "@/lib/training-display-state";

/**
 * Map training events onto a list of dates to produce ScheduleDay[]: one row
 * per workout — each session on a date, in the order `events` gives them (the
 * calendar's order: by date, a day's sessions in the day's order) — and one
 * rest row for a date holding none. A day can hold several sessions, each its
 * own workout, so a date can have several rows.
 * Pure function — no DB calls and no clock of its own.
 *
 * Each row says two things separately: its `status` is whether the workout was
 * logged (scheduled / completed / missed, or rest for a day with none), and its
 * `completionQuality` is how it went, off the workout's own log. `today` is the
 * day the caller's calendar is on — the coach's for the coach's history table,
 * the client's for the week a check-in freezes — and decides which still-
 * scheduled workouts have been missed.
 *
 * `performedSessionNames` (keyed by the log's performed `training_session_id`)
 * lets a swap name the session the client actually did; without it a swap still
 * reads as one, under the prescribed name.
 */
export function mapEventsToScheduleDays(
  dates: string[],
  events: TrainingEvent[],
  today: string,
  performedSessionNames?: Map<string, string>
): ScheduleDay[] {
  const eventsByDate = new Map<string, TrainingEvent[]>();
  for (const event of events) {
    const dateKey = event.date.split("T")[0];
    eventsByDate.set(dateKey, [...(eventsByDate.get(dateKey) ?? []), event]);
  }

  return dates.flatMap((date): ScheduleDay[] => {
    const dayNum = new Date(date + "T00:00:00").getDay();
    const dayOfWeek = DAY_NAMES[dayNum] ?? "monday";
    const dayEvents = eventsByDate.get(date) ?? [];

    if (dayEvents.length === 0) {
      return [
        {
          date,
          dayOfWeek,
          status: "rest" as TrainingDayStatus,
          plannedSessionId: null,
          plannedSessionName: null,
          loggedSessionName: null,
          completionQuality: null,
          isAlternative: false,
          notes: null,
          sessionLogId: null,
        },
      ];
    }

    return dayEvents.map((event): ScheduleDay => {
      const state = trainingDisplayState(
        { ...eventWorkoutRead(event), date },
        today
      );
      const logged = isLogged(state);

      // A swap: the log is for a session other than the one prescribed on this
      // date. The row then names the session the client PERFORMED — its live
      // name when the caller resolved one, else the prescribed name, never the
      // prescribed snapshot, which would mislabel the swap.
      const performedId = event.log?.performedSessionId ?? null;
      const isAlternative =
        logged &&
        performedId !== null &&
        event.trainingSessionId !== null &&
        performedId !== event.trainingSessionId;

      return {
        date,
        dayOfWeek,
        status: scheduleStatus(state),
        plannedSessionId: event.trainingSessionId ?? event.id,
        plannedSessionName: event.sessionName,
        loggedSessionName: logged
          ? (isAlternative && performedId
              ? performedSessionNames?.get(performedId)
              : undefined) ?? event.sessionName
          : null,
        completionQuality: qualityOf(state),
        isAlternative,
        notes: event.log?.notes ?? null,
        sessionLogId: event.sessionLogId ?? null,
      };
    });
  });
}

/** Whether the client logged the workout — a skipped one is an empty log, not a workout done. */
function isLogged(state: TrainingDisplayState): boolean {
  return state === "completed_full" || state === "completed_partial";
}

function scheduleStatus(state: TrainingDisplayState): TrainingDayStatus {
  if (isLogged(state)) return "completed";
  // A skipped workout is the client saying they did not do it: the same row a
  // missed one writes, with `skipped` as its quality. Both leave in commit 9.
  if (state === "skipped" || state === "missed") return "missed";
  return "scheduled";
}

function qualityOf(state: TrainingDisplayState): ScheduleDay["completionQuality"] {
  if (state === "completed_full") return "full";
  if (state === "completed_partial") return "partial";
  if (state === "skipped") return "skipped";
  return null;
}
