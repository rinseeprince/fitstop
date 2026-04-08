import type { TrainingEvent } from "@/types/training";
import type { ScheduleDay, TrainingDayStatus } from "@/types/schedule";
import { DAY_NAMES, getTodayDateString } from "@/lib/date-helpers";

/**
 * Map training events onto a list of dates to produce ScheduleDay[].
 * Pure function — no DB calls.
 *
 * Status logic:
 * - Event completed/partial/skipped → map directly
 * - Event scheduled + date in past → missed
 * - Event scheduled + date today or future → rest (with planned fields populated)
 * - No event for date → rest
 */
export function mapEventsToScheduleDays(
  dates: string[],
  events: TrainingEvent[]
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

  return dates.map((date) => {
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
      };
    }

    const { status, completionQuality, loggedSessionName } = resolveEventStatus(
      event,
      date,
      today
    );

    return {
      date,
      dayOfWeek,
      status,
      plannedSessionId: event.trainingSessionId ?? event.id,
      plannedSessionName: event.sessionName,
      loggedSessionName,
      completionQuality,
      isAlternative: false,
      notes: null,
    };
  });
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
