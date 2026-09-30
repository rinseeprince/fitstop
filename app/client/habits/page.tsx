"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { LockedDayNotice } from "@/components/client-portal/day/locked-day-notice";
import { HabitNumberRow } from "@/components/client-portal/habits/habit-number-row";
import { HabitToggleRow } from "@/components/client-portal/habits/habit-toggle-row";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProfile } from "@/hooks/use-client-profile";
import { HabitEntryError, useClientHabitDay, useHabitEntryWrites } from "@/hooks/use-client-portal-habits";
import { toast } from "sonner";
import { canEditDay } from "@/lib/daily-log-permissions";
import { parseDateParamOrToday } from "@/lib/date-helpers";
import type { ClientHabitDayItem, HabitAnswer } from "@/types/habits";

function formatHeading(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function HabitLogInner() {
  const searchParams = useSearchParams();
  const date = parseDateParamOrToday(searchParams?.get("date") ?? null);

  const { client } = useClientProfile();
  const timezone = client?.timezone ?? "UTC";
  // The day rule answers once for the whole day: habits lock with it.
  const editable = canEditDay(date, client?.logsOpenFrom ?? null, timezone);

  // Every habit a version covers on the date, planned that day or not: the
  // client can make an entry on any of them.
  const { day, error, isLoading, retry } = useClientHabitDay(date);
  const entries = useHabitEntryWrites(date);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  /** One write for one habit: its row busy while in flight, the server's sentence on a refusal. */
  async function write(item: ClientHabitDayItem, run: () => Promise<void>) {
    setSavingIds((prev) => new Set(prev).add(item.habit.id));
    try {
      await run();
    } catch (err) {
      if (!(err instanceof HabitEntryError)) {
        // No answer came back: the browser's own words ("Failed to fetch") are
        // not the client's, so the page says what the other log pages say.
        console.error("[habits] entry write failed:", err);
        toast.error("Couldn't update habit", { description: "Network error. Please try again." });
      } else if (err.status === 403) {
        // The day locked underneath us (a check-in sent from another tab):
        // read the day again so each row shows the entry saved on it. The rows
        // lock from the profile's `logsOpenFrom`, which this page does not
        // read again, so they stay open and a further write meets the same
        // refusal.
        toast.error("This day is locked", { description: err.message });
        retry();
      } else {
        toast.error("Couldn't update habit", { description: err.message });
        // The coach deleted the habit (404) or stopped it (409): the day
        // changed underneath us, so it is read again.
        if (err.status === 404 || err.status === 409) retry();
      }
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.habit.id);
        return next;
      });
    }
  }

  const save = (item: ClientHabitDayItem, answer: HabitAnswer) => write(item, () => entries.save(item, answer));
  const clear = (item: ClientHabitDayItem) => write(item, () => entries.clear(item));

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-destructive">We couldn&apos;t load your habits.</p>
        <button type="button" onClick={retry} className="text-sm text-primary underline">
          Try again
        </button>
      </div>
    );
  }

  if (isLoading || !day) {
    return <HabitLogSkeleton />;
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-foreground">Log habits</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatHeading(date)}</p>

      {!editable ? <LockedDayNotice reason="locked" /> : null}

      <Card className="mt-4">
        <CardContent className="space-y-4 py-6">
          {day.habits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No habits on this day</p>
          ) : (
            day.habits.map((item) =>
              item.habit.measure === "number" ? (
                <HabitNumberRow
                  // A new entry from the server mounts the box fresh on it.
                  key={`${item.habit.id}:${item.day.entry?.value ?? ""}`}
                  item={item}
                  isSaving={savingIds.has(item.habit.id)}
                  disabled={!editable}
                  onCommit={(value) => (value === null ? clear(item) : save(item, { value }))}
                  onInvalid={(reason) => toast.error("Couldn't update habit", { description: reason })}
                />
              ) : (
                <HabitToggleRow
                  key={item.habit.id}
                  item={item}
                  isSaving={savingIds.has(item.habit.id)}
                  disabled={!editable}
                  onToggle={(checked) => void save(item, { done: checked })}
                />
              )
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HabitLogSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Card className="mt-4">
        <CardContent className="space-y-4 py-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

export default function ClientHabitsLogPage() {
  return (
    <Suspense fallback={<HabitLogSkeleton />}>
      <HabitLogInner />
    </Suspense>
  );
}
