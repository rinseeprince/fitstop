"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ClientLayoutError,
  useApplyClientLayout,
  useClientTrainingWeek,
} from "@/hooks/use-client-training-data";
import { getTodayDateString } from "@/lib/date-helpers";
import { cn } from "@/lib/utils";
import { buildWeekLayout, type WeekPlacements } from "@/lib/week-layout";
import { formatDay, stateClass } from "@/components/client-portal/training/session-state";
import { SessionChip } from "./training-week-session-chip";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

const STACK_MESSAGE = "Two sessions on one day — move one";
const IDLE_HINT = "Tap a session, then the day to move it to.";
const STACK_HINT = "Move one of the doubled-up sessions before saving.";
/** 409 = the week changed under the client (drift, or a day taken since) — reload, don't retry. */
const RELOAD_STATUS = 409;

type Refusal = { message: string; status: number | null };

/**
 * This week, rearrangeable (owner decision 2026-08-26: a client may move their
 * own sessions within the week). Tap a session to pick it up, tap a day to put
 * it there. A day holding two sessions shows both and blocks Save until one is
 * moved on — that is how a swap is made, and it is the server's occupancy rule
 * applied before the round trip — so the week is never saved half-applied.
 * Save is ONE layout write (`POST /api/client/training/events/layout`) carrying
 * every changed session with the day it was read on, so a coach edit in the
 * meantime answers 409 and the client reloads instead of overwriting it.
 *
 * What the week looks like with the unsaved moves — and the write that makes
 * it so — is `lib/week-layout.ts`; this component only renders and taps.
 * Tap-to-move on purpose: the web app is the harness, React Native is the
 * client (CONVENTIONS §14), so there is no drag.
 *
 * While a session is picked up every day row becomes the drop target and the
 * chips go static, so a button never nests in a button; tapping the row the
 * session already sits on simply puts it down.
 */
export function TrainingWeekLayout() {
  const { data, isLoading, error: loadError, mutate } = useClientTrainingWeek(getTodayDateString());
  const applyLayout = useApplyClientLayout();
  const { toast } = useToast();

  const [placements, setPlacements] = useState<WeekPlacements>({});
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const week = data?.data ?? null;
  const layout = useMemo(
    () => (week ? buildWeekLayout(week, placements) : null),
    [week, placements],
  );
  const selected = useMemo(
    () => week?.sessions.find((s) => s.eventId === selectedEventId) ?? null,
    [week, selectedEventId],
  );

  if (isLoading && !week) {
    return (
      <div data-testid="training-week-layout-loading">
        <Skeleton className="h-40 w-full rounded-[6px]" />
      </div>
    );
  }
  if (loadError || !week || !layout) {
    return <p className="text-[13px] text-[#5a7d82]">Couldn&apos;t load your week.</p>;
  }
  // Nothing to move — the section has no business on the page.
  if (week.sessions.length === 0) return null;

  const clearPending = () => {
    setPlacements({});
    setSelectedEventId(null);
    setRefusal(null);
  };

  const pickUp = (session: ClientTrainingWeekSession) => {
    if (saving) return;
    setRefusal(null);
    setSelectedEventId((current) => (current === session.eventId ? null : session.eventId));
  };

  const putDown = (date: string) => {
    if (!selected || saving) return;
    setPlacements((current) => ({ ...current, [selected.eventId]: date }));
    setSelectedEventId(null);
  };

  const save = async () => {
    if (!layout.canSave || saving) return;
    setSaving(true);
    setRefusal(null);
    try {
      await applyLayout(layout.moves);
      // The area invalidation inside applyLayout refetches the week, so the
      // chips settle on their saved days once the pending state is gone.
      setPlacements({});
      setSelectedEventId(null);
      toast({ title: "Week updated" });
    } catch (error) {
      setRefusal({
        message: error instanceof Error ? error.message : "Failed to move sessions",
        status: error instanceof ClientLayoutError ? error.status : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const reload = () => {
    clearPending();
    void mutate();
  };

  const hint = selected
    ? `Tap a day to move ${selected.name} there.`
    : layout.conflictDates.length > 0
      ? STACK_HINT
      : IDLE_HINT;

  return (
    <section className="space-y-3" data-testid="training-week-layout" aria-busy={saving}>
      <header className="space-y-0.5">
        <h2 className="text-[15px] font-semibold text-[#0c1a1e]">This week</h2>
        <p className="text-[12px] text-[#5a7d82]">{hint}</p>
      </header>

      <ul className="space-y-1.5">
        {layout.days.map((day) => {
          const stacked = day.entries.length > 1;
          const rowClass = cn(
            "flex w-full items-start gap-3 rounded-[6px] bg-white px-3 py-2 text-left",
            day.isPast && "opacity-70",
            stacked && "ring-1 ring-[#c06060]",
            selected && "transition-colors hover:bg-[rgba(13,148,136,0.04)]",
          );
          const content = (
            <>
              <span className="w-14 shrink-0">
                <span className="block text-[13px] font-semibold text-[#0c1a1e]">
                  {format(new Date(day.date + "T00:00:00"), "EEE")}
                </span>
                <span className="block text-[11px] text-[#5a7d82]">
                  {format(new Date(day.date + "T00:00:00"), "MMM d")}
                </span>
                {day.isToday && (
                  <span
                    className={`mt-0.5 inline-block rounded-[6px] px-1.5 py-px text-[10px] ${stateClass("today")}`}
                  >
                    Today
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {day.entries.length === 0 ? (
                  <span className="py-1 text-[12px] text-[#93b0b4]">Rest</span>
                ) : (
                  day.entries.map((entry) => (
                    <SessionChip
                      key={entry.session.eventId}
                      entry={entry}
                      selectable={!selected && !saving}
                      isSelected={entry.session.eventId === selectedEventId}
                      onPickUp={pickUp}
                    />
                  ))
                )}
                {stacked && <span className="text-[12px] text-[#c06060]">{STACK_MESSAGE}</span>}
              </span>
            </>
          );
          return (
            <li key={day.date}>
              {selected ? (
                <button
                  type="button"
                  className={rowClass}
                  disabled={saving}
                  aria-label={`Move ${selected.name} to ${formatDay(day.date)}`}
                  onClick={() => putDown(day.date)}
                >
                  {content}
                </button>
              ) : (
                <div className={rowClass}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>

      {refusal && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] bg-[rgba(192,96,96,0.08)] px-3 py-2 text-[13px] text-[#c06060]"
        >
          <span>{refusal.message}</span>
          {refusal.status === RELOAD_STATUS && (
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Reload
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {layout.isDirty && (
          <Button type="button" variant="ghost" onClick={clearPending} disabled={saving}>
            Reset
          </Button>
        )}
        <Button
          type="button"
          className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          disabled={!layout.canSave || saving}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </section>
  );
}
