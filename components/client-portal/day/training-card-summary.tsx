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

export function TrainingCardSummary({ events, date }: Props) {
  const isFuture = date > getTodayDateString();

  if (events.length === 0) {
    return (
      <DsCardSummary title="Training">
        <DsCardSummaryRow
          leadingText="Rest day"
          trailingText="No training scheduled"
        />
      </DsCardSummary>
    );
  }

  return (
    <DsCardSummary title="Training">
      {events.map((event) => (
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
      ))}
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
