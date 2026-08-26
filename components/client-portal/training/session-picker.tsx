"use client";

import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientTrainingWeek } from "@/hooks/use-client-training-data";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

type Props = {
  /** The day being acted on — the picker lists the training week containing it. */
  date: string;
  onPick: (session: ClientTrainingWeekSession) => void;
  onCancel: () => void;
  title?: string;
  /** The event the client is already on (a prescribed day's tracker) — not offered. */
  excludeEventId?: string | null;
  /** A refusal from the last pick, in the server's own words. */
  error?: string | null;
  /** A pick is being applied — buttons are disabled until it lands. */
  busy?: boolean;
};

/**
 * Lists THIS WEEK's still-to-do sessions — the exact set a pick can act on —
 * each with its weekday and state, so the client sees what a pick will do
 * before it does it: the session moves (or swaps) onto the day they are
 * logging. What each pick means is decided by `lib/session-pick.ts`, not
 * here; this component only offers the list.
 *
 * It used to list every slot of the whole program (~32 rows for an 8-week
 * plan, no day, no state), so a pick from week 6 logged week 6's prescription
 * against a week-1 rest day.
 */
export function SessionPicker({
  date,
  onPick,
  onCancel,
  title = "Pick a session",
  excludeEventId = null,
  error = null,
  busy = false,
}: Props) {
  const { data, isLoading, error: loadError } = useClientTrainingWeek(date);

  const week = data?.data ?? null;
  // Only a session that can still be done is offered: Today, Upcoming, and
  // Missed-but-still-scheduled (the make-up case). A done or skipped session
  // has nothing left to do — offering it again only invites a duplicate log
  // (owner decision 2026-08-26).
  const sessions = (week?.sessions ?? []).filter(
    (s) => s.isScheduled && s.eventId !== excludeEventId,
  );

  return (
    <div className="space-y-4" data-testid="session-picker">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-[#0c1a1e]">{title}</h1>
        <p className="text-[13px] text-[#5a7d82]">
          Choose a session from this week.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[6px]" />
          ))}
        </div>
      ) : loadError || !week ? (
        <p className="text-[13px] text-[#5a7d82]">
          Couldn&apos;t load your week. Please try again.
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-[13px] text-[#5a7d82]">
          No sessions in your week to pick from.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.eventId}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(s)}
                className="flex w-full items-center justify-between gap-3 rounded-[6px] bg-white px-4 py-3 text-left transition-colors hover:bg-[rgba(13,148,136,0.04)] disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-[#0c1a1e]">{s.name}</span>
                  <span className="block text-[12px] text-[#5a7d82]">
                    {formatDay(s.date)}
                    {s.focus ? ` · ${s.focus}` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] ${stateClass(s.state)}`}
                >
                  {stateLabel(s.state)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-[#c06060]">
          {error}
        </p>
      )}

      <div className="flex justify-start">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// The app's date spelling (`EEE, MMM d`) — see training-event-occupancy.ts.
function formatDay(date: string): string {
  return format(new Date(date + "T00:00:00"), "EEE, MMM d");
}

// Only still-scheduled sessions reach these: today, upcoming, or missed.
function stateLabel(state: ClientTrainingWeekSession["state"]): string {
  switch (state) {
    case "today":
      return "Today";
    case "missed":
      return "Missed";
    default:
      return "Upcoming";
  }
}

function stateClass(state: ClientTrainingWeekSession["state"]): string {
  switch (state) {
    case "missed":
      return "bg-[rgba(192,96,96,0.08)] text-[#c06060]";
    case "today":
      return "bg-[rgba(13,148,136,0.05)] text-[#0d9488]";
    default:
      return "bg-[#f0f4f4] text-[#5a7d82]";
  }
}
