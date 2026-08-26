import type { TrainingEventSummary } from "@/types/training";

import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";

type Props = {
  events: TrainingEventSummary[];
  date: string;
  /**
   * Sessions logged ON `date` whose matched prescribed event falls on a
   * different date (Session 5.4 "Trained for {day}" line). Empty in the normal
   * case. Defaulted so existing callers/tests without the field keep working.
   */
  trainedFor?: { date: string; sessionName: string }[];
};

export function TrainingCardSummary({ events, date, trainedFor = [] }: Props) {
  const isFuture = date > getTodayDateString();

  return (
    <DsCardSummary title="Training">
      {events.length === 0 ? (
        // Rest day. Clickable for today/past (never future) so the client can
        // log a session they did anyway — routes to the rest-day picker.
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
        events.map((event) =>
          event.loggedOn && event.loggedOn !== date ? (
            // Receipt: prescribed here, performed on `loggedOn` (an alternative
            // session). Not a workout to do — it opens READ-ONLY (the tracker
            // locks it; the server refuses a write), never "Tap to log".
            <DsCardSummaryRow
              key={event.eventId}
              href={
                isFuture
                  ? undefined
                  : `/client/training?eventId=${event.eventId}&date=${date}`
              }
              leadingText={event.sessionName}
              trailingText={`Done ${formatWeekday(event.loggedOn)}`}
              hint={isFuture ? undefined : "Tap to view"}
              ariaLabel={`${event.sessionName} — done ${formatWeekday(event.loggedOn)}`}
            />
          ) : (
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
          )
        )
      )}

      {/* "Trained for {weekday} {session}" — a session logged today that the
          matcher attributed to a prescribed event on another day. */}
      {trainedFor.map((t, i) => (
        <DsCardSummaryRow
          key={`trained-for-${i}`}
          leadingText={`Trained for ${formatWeekday(t.date)}`}
          trailingText={t.sessionName}
          ariaLabel={`Trained for ${formatWeekday(t.date)} ${t.sessionName}`}
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

function formatWeekday(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return "";
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d)).toLocaleDateString(
    undefined,
    { weekday: "long" },
  );
}
