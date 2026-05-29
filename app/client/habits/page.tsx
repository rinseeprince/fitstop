"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";

import { LockedDayNotice } from "@/components/client-portal/day/locked-day-notice";
import { HabitToggleRow } from "@/components/client-portal/habits/habit-toggle-row";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProfile } from "@/hooks/use-client-profile";
import { useToast } from "@/hooks/use-toast";
import { canEditDay } from "@/lib/daily-log-permissions";
import { parseDateParamOrToday } from "@/lib/date-helpers";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

type HabitsResponse = { success: boolean; data: DailyHabit[] };
type LogsResponse = { success: boolean; data: HabitLogWithDetails[] };

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
} as const;

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

  const { toast } = useToast();
  const { client } = useClientProfile();
  const timezone = client?.timezone ?? "UTC";

  // Two keys: the habit list is date-independent (dedupes across dates); the logs key
  // carries ?date= so navigating days refetches only the per-date state.
  const habitsKey = "/api/client/habits";
  const logsKey = `/api/client/habits/logs/today?date=${date}`;

  const habitsRes = useSWR<HabitsResponse>(habitsKey, swrFetcher, {
    ...SWR_OPTS,
    onError: (err) => console.error("[habit-log] habits fetch failed:", err),
  });
  const logsRes = useSWR<LogsResponse>(logsKey, swrFetcher, {
    ...SWR_OPTS,
    onError: (err) => console.error("[habit-log] logs fetch failed:", err),
  });

  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const error = habitsRes.error || logsRes.error;
  const isLoading = habitsRes.isLoading || logsRes.isLoading;

  const allHabits = habitsRes.data?.data ?? [];
  const logs = logsRes.data?.data ?? [];

  // Render only habits that had become effective by this date (can't log a habit before
  // it existed); derive the lock per-habit so a missed past day stays backfillable.
  const visibleHabits = allHabits.filter((h) => h.effectiveDate <= date);
  const logMap = new Map(logs.map((l) => [l.dailyHabitId, l]));

  const habitStates = visibleHabits.map((habit) => ({
    habit,
    completed: logMap.get(habit.id)?.completed ?? false,
    editable: canEditDay(date, logMap.has(habit.id) ? "logged" : "never-logged", timezone),
  }));
  const fullyLocked = habitStates.length > 0 && habitStates.every((s) => !s.editable);

  async function handleToggle(habit: DailyHabit, checked: boolean) {
    setSavingIds((prev) => new Set(prev).add(habit.id));

    const existing = logMap.get(habit.id);
    const optimisticLog: HabitLogWithDetails = {
      id: existing?.id ?? `temp-${habit.id}`,
      dailyHabitId: habit.id,
      clientId: habit.clientId,
      date,
      completed: checked,
      value: existing?.value,
      notes: existing?.notes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      habitName: habit.name,
      targetValue: habit.targetValue,
      targetUnit: habit.targetUnit,
      isBoolean: habit.isBoolean,
    };
    const nextLogs: HabitLogWithDetails[] = [
      ...logs.filter((l) => l.dailyHabitId !== habit.id),
      optimisticLog,
    ];

    try {
      await logsRes.mutate(
        async () => {
          const res = await fetch("/api/client/habits/log", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dailyHabitId: habit.id, date, completed: checked }),
          });
          const json = (await res.json().catch(() => null)) as
            | { success?: boolean; data?: DailyHabitLog; error?: string }
            | null;

          if (!res.ok || !json?.success) {
            if (res.status === 403) {
              // The habit locked underneath us (e.g. recorded in another tab). Refetch so
              // the row flips to its true locked state.
              toast({
                title: "This day is locked",
                description: json?.error ?? "This habit can no longer be edited.",
                variant: "destructive",
              });
              void logsRes.mutate();
            } else {
              toast({
                title: "Couldn't update habit",
                description: json?.error ?? "Please try again.",
                variant: "destructive",
              });
            }
            throw new Error(json?.error ?? "save-failed");
          }

          // logHabit returns a bare DailyHabitLog — re-attach the display fields the row needs.
          const saved = json.data as DailyHabitLog;
          const merged: HabitLogWithDetails = {
            ...saved,
            habitName: habit.name,
            targetValue: habit.targetValue,
            targetUnit: habit.targetUnit,
            isBoolean: habit.isBoolean,
          };
          return {
            success: true,
            data: [...logs.filter((l) => l.dailyHabitId !== habit.id), merged],
          };
        },
        {
          optimisticData: { success: true, data: nextLogs },
          rollbackOnError: true,
          revalidate: false,
          populateCache: true,
        },
      );

      // Refresh the home day-summary so its Habits card reflects the new log.
      void globalMutate(`/api/client/day-summary?date=${date}`);
    } catch {
      // Toast already shown; rollbackOnError reverted the optimistic flip.
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(habit.id);
        return next;
      });
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-destructive">We couldn&apos;t load your habits.</p>
        <button
          type="button"
          onClick={() => {
            void habitsRes.mutate();
            void logsRes.mutate();
          }}
          className="text-sm text-primary underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (isLoading || !habitsRes.data || !logsRes.data) {
    return <HabitLogSkeleton />;
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-foreground">Log habits</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatHeading(date)}</p>

      {fullyLocked ? <LockedDayNotice reason="past-logged" /> : null}

      <Card className="mt-4">
        <CardContent className="space-y-4 py-6">
          {allHabits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No daily habits set up yet</p>
          ) : visibleHabits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No habits were active on this date</p>
          ) : (
            habitStates.map(({ habit, completed, editable }) => (
              <HabitToggleRow
                key={habit.id}
                habit={habit}
                completed={completed}
                isSaving={savingIds.has(habit.id)}
                disabled={!editable}
                onToggle={(checked) => handleToggle(habit, checked)}
              />
            ))
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
