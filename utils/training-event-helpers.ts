import type { TrainingEvent } from "@/types/training";
import type { ScheduleDay, TrainingDayStatus } from "@/types/schedule";
import { DAY_NAMES, getTodayDateString } from "@/lib/date-helpers";

/** Session log shape used for unlinked log merging and swap detection. */
type UnlinkedSessionLog = {
  id: string;
  training_session_id: string | null;
  completed_at: string;
  completion_quality: string | null;
  notes: string | null;
  prescribed_session_snapshot: unknown;
};

/**
 * Map training events onto a list of dates to produce ScheduleDay[]: one row
 * per workout — each session on a date, in the order `events` gives them (the
 * calendar's order: by date, a day's sessions in the day's order) — and one
 * rest row for a date holding none. A day can hold several sessions, each its
 * own workout, so a date can have several rows.
 * Pure function — no DB calls.
 *
 * Status logic:
 * - Event completed/partial/skipped → map directly
 * - Event scheduled + date in past → missed
 * - Event scheduled + date today or future → rest (with planned fields populated)
 * - No event for date → rest
 *
 * Unlinked session logs (completed sessions with no matching event) are merged
 * onto their date's first row that can take them:
 * - A missed workout → completed_swap + isAlternative
 * - A rest day (no planned event) → rest_trained + isAlternative
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
  const eventsByDate = new Map<string, TrainingEvent[]>();
  for (const event of events) {
    const dateKey = event.date.split("T")[0];
    eventsByDate.set(dateKey, [...(eventsByDate.get(dateKey) ?? []), event]);
  }

  const today = getTodayDateString();

  const schedule: ScheduleDay[] = dates.flatMap((date): ScheduleDay[] => {
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
  });

  // Merge unlinked session logs (completions with no matching event)
  if (unlinkedLogs && unlinkedLogs.length > 0) {
    for (const log of unlinkedLogs) {
      const logDate = log.completed_at.substring(0, 10);
      // The date's first row a log can land on: a missed workout or a rest day.
      const day = schedule.find(
        (row) => row.date === logDate && (row.status === "missed" || row.status === "rest"),
      );
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
