import type { TrainingEventSummary } from "@/types/training";

import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";

type Props = {
  events: TrainingEventSummary[];
  date: string;
};

/**
 * The day's training, one row per event. A workout has one date — the event's
 * — because the client moves the event to the day they train, so there is no
 * "done on another day" state to render here: an event on this day was either
 * done here, is to be done here, or was missed here.
 */
export function TrainingCardSummary({ events, date }: Props) {
  const isFuture = date > getTodayDateString();

  return (
    <DsCardSummary title="Training">
      {events.length === 0 ? (
        // Rest day. Clickable for today/past (never future) so the client can
        // pick a session from this week — it moves to this day and opens.
        <DsCardSummaryRow
          leadingText="Rest day"
          trailingText="No training scheduled"
          href={isFuture ? undefined : `/client/training?date=${date}`}
          hint={isFuture ? undefined : "Tap to log a session"}
          ariaLabel={
            isFuture
              ? "Rest day — no training scheduled"
              : "Rest day — tap to log a session"
          }
        />
      ) : (
        events.map((event) => (
          <DsCardSummaryRow
            key={event.eventId}
            href={
              isFuture
                ? undefined
                : `/client/training?eventId=${event.eventId}&date=${date}`
            }
            leadingText={event.sessionName}
            trailingText={formatEventState(event)}
            hint={isFuture ? undefined : hintFor(event)}
            ariaLabel={`${event.sessionName} — ${formatEventState(event)}`}
          />
        ))
      )}
    </DsCardSummary>
  );
}

function formatEventState(e: TrainingEventSummary): string {
  if (e.loggedExerciseCount > 0) {
    return `${e.loggedExerciseCount}/${e.prescribedExerciseCount} exercises logged`;
  }
  if (e.completionQuality === null) return "Not logged yet";
  if (e.completionQuality === "full") return "Logged as complete";
  if (e.completionQuality === "partial") return "Logged as partial";
  return "Logged as skipped";
}

function hintFor(e: TrainingEventSummary): string {
  const unlogged = e.completionQuality === null && e.loggedExerciseCount === 0;
  return unlogged ? "Tap to log" : "Tap to view";
}
