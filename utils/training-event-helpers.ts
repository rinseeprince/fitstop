import type { TrainingEvent } from "@/types/training";
import type { ScheduleDay, TrainingDayStatus } from "@/types/schedule";
import { DAY_NAMES, getTodayDateString } from "@/lib/date-helpers";

/** Session log shape used for unlinked log merging and swap detection. */
export type UnlinkedSessionLog = {
  id: string;
  training_session_id: string | null;
  completed_at: string;
  completion_quality: string | null;
  notes: string | null;
  prescribed_session_snapshot: unknown;
};

/**
 * Map training events onto a list of dates to produce ScheduleDay[].
 * Pure function — no DB calls.
 *
 * Status logic:
 * - Event completed/partial/skipped → map directly
 * - Event scheduled + date in past → missed
 * - Event scheduled + date today or future → rest (with planned fields populated)
 * - No event for date → rest
 *
 * Unlinked session logs (completed sessions with no matching event) are merged:
 * - Missed day (had a planned event) → completed_swap + isAlternative
 * - Rest day (no planned event) → rest_trained + isAlternative
 */
export function mapEventsToScheduleDays(
  dates: string[],
  events: TrainingEvent[],
  unlinkedLogs?: UnlinkedSessionLog[],
  sessionLogMap?: Map<string, UnlinkedSessionLog>,
  // Live names keyed by the log's performed training_session_id. Lets a swap
  // show the session the client actually did, not the prescribed snapshot.
  performedSessionNames?: Map<string, string>
): ScheduleDay[] {
  // When multiple events exist on the same date (e.g. from backfill across plan versions),
  // prefer the most informative: completed > partial > skipped > missed > scheduled
  const STATUS_PRIORITY: Record<string, number> = {
    completed: 4, partial: 3, skipped: 2, missed: 1, scheduled: 0,
  };

  const eventMap = new Map<string, TrainingEvent>();
  for (const event of events) {
    const dateKey = event.date.split("T")[0];
    const existing = eventMap.get(dateKey);
    const eventPriority = STATUS_PRIORITY[event.status] ?? 0;
    const existingPriority = existing ? (STATUS_PRIORITY[existing.status] ?? 0) : -1;
    if (eventPriority > existingPriority) {
      eventMap.set(dateKey, event);
    }
  }

  const today = getTodayDateString();

  const schedule: ScheduleDay[] = dates.map((date) => {
    const dayNum = new Date(date + "T00:00:00").getDay();
    const dayOfWeek = DAY_NAMES[dayNum] ?? "monday";
    const event = eventMap.get(date);

    if (!event) {
      return {
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
      };
    }

    const resolved = resolveEventStatus(event, date, today);
    let status = resolved.status;
    const completionQuality = resolved.completionQuality;
    let loggedSessionName = resolved.loggedSessionName;
    let isAlternative = false;
    let notes: string | null = null;

    // Detect alternative session: event linked to a log for a different session
    if (
      sessionLogMap &&
      event.sessionLogId &&
      (status === "completed" || status === "partial")
    ) {
      const linkedLog = sessionLogMap.get(event.sessionLogId);
      if (linkedLog && linkedLog.training_session_id !== event.trainingSessionId) {
        status = "completed_swap";
        isAlternative = true;
        // Show the PERFORMED session's live name (the log's training_session_id),
        // not the prescribed snapshot. The snapshot here is the prescribed
        // session (event's session), so it would mislabel the swap.
        const snapshot = linkedLog.prescribed_session_snapshot as Record<string, unknown> | null;
        const performedName = linkedLog.training_session_id
          ? performedSessionNames?.get(linkedLog.training_session_id)
          : undefined;
        loggedSessionName =
          performedName ??
          (typeof snapshot?.name === "string" ? snapshot.name : null) ??
          loggedSessionName;
        notes = linkedLog.notes;
      }
    }

    return {
      date,
      dayOfWeek,
      status,
      plannedSessionId: event.trainingSessionId ?? event.id,
      plannedSessionName: event.sessionName,
      loggedSessionName,
      completionQuality,
      isAlternative,
      notes,
      sessionLogId: event.sessionLogId ?? null,
    };
  });

  // Merge unlinked session logs (completions with no matching event)
  if (unlinkedLogs && unlinkedLogs.length > 0) {
    const scheduleByDate = new Map(schedule.map((day) => [day.date, day]));

    for (const log of unlinkedLogs) {
      const logDate = log.completed_at.substring(0, 10);
      const day = scheduleByDate.get(logDate);
      if (!day) continue;

      const snapshot = log.prescribed_session_snapshot as Record<string, unknown> | null;
      const logSessionName =
        (typeof snapshot?.name === "string" ? snapshot.name : null) ?? "Training";
      const quality = (log.completion_quality ?? "full") as "full" | "partial" | "skipped";

      if (day.status === "missed") {
        // Had a planned event but client did a different session
        day.status = "completed_swap";
        day.loggedSessionName = logSessionName;
        day.completionQuality = quality;
        day.isAlternative = true;
        day.notes = log.notes;
        day.sessionLogId = log.id;
      } else if (day.status === "rest") {
        // Rest day but client trained anyway
        day.status = "rest_trained";
        day.loggedSessionName = logSessionName;
        day.completionQuality = quality;
        day.isAlternative = true;
        day.notes = log.notes;
        day.sessionLogId = log.id;
      }
      // Skip if day already completed/partial — don't overwrite
    }
  }

  return schedule;
}

function resolveEventStatus(
  event: TrainingEvent,
  date: string,
  today: string
): {
  status: TrainingDayStatus;
  completionQuality: "full" | "partial" | "skipped" | null;
  loggedSessionName: string | null;
} {
  switch (event.status) {
    case "completed":
      return {
        status: "completed",
        completionQuality: "full",
        loggedSessionName: event.sessionName,
      };
    case "partial":
      return {
        status: "partial",
        completionQuality: "partial",
        loggedSessionName: event.sessionName,
      };
    case "skipped":
      return {
        status: "missed",
        completionQuality: "skipped",
        loggedSessionName: null,
      };
    case "missed":
      return {
        status: "missed",
        completionQuality: null,
        loggedSessionName: null,
      };
    case "scheduled":
      // Scheduled but date has passed → missed
      if (date < today) {
        return {
          status: "missed",
          completionQuality: null,
          loggedSessionName: null,
        };
      }
      // Future/today scheduled event: show as rest with planned fields set
      return {
        status: "rest",
        completionQuality: null,
        loggedSessionName: null,
      };
    default:
      return {
        status: "rest",
        completionQuality: null,
        loggedSessionName: null,
      };
  }
}

/**
 * Aggregate estimated calories from events by day of week.
 * Returns { monday: 0, ..., sunday: 0 } with event calories summed per day.
 * Pure function — no DB calls.
 */
export function getEventCaloriesByDay(
  events: TrainingEvent[]
): Record<string, number> {
  const result: Record<string, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  };

  for (const event of events) {
    const dayNum = new Date(event.date + "T00:00:00").getDay();
    const dayName = DAY_NAMES[dayNum];
    if (dayName && event.estimatedCalories) {
      result[dayName] += event.estimatedCalories;
    }
  }

  return result;
}
