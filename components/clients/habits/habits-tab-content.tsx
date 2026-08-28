"use client";

import { useState, useMemo } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HabitsManageDrawer } from "./habits-manage-drawer";
import { HabitsWeekNav } from "./habits-week-nav";
import { HabitsSummaryStrip } from "./habits-summary-strip";
import { HabitsWeekTracker } from "./habits-week-tracker";
import { useClientHabits } from "@/hooks/use-client-habits";
import { useHabitsWeek } from "@/hooks/use-habits-week";
import {
  getTodayDateString,
  getTrainingWeekStart,
  getTrainingWeekEnd,
  getDateString,
} from "@/lib/date-helpers";
import { checkInWeekday } from "@/lib/check-in-week";
import type { Client } from "@/types/check-in";

type HabitsTabContentProps = {
  client: Client;
};

export const HabitsTabContent = ({ client }: HabitsTabContentProps) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const today = useMemo(() => getTodayDateString(), []);
  const checkInDay = checkInWeekday(client);

  const weekStart = useMemo(() => {
    const baseStart = getTrainingWeekStart(today, checkInDay);
    if (weekOffset === 0) return baseStart;
    const d = new Date(baseStart + "T00:00:00");
    d.setDate(d.getDate() + weekOffset * 7);
    return getDateString(d);
  }, [today, checkInDay, weekOffset]);

  const weekEnd = useMemo(
    () => getTrainingWeekEnd(weekStart, checkInDay),
    [weekStart, checkInDay]
  );

  const {
    habits,
    isLoading: habitsLoading,
    error: habitsError,
    createHabit,
    updateHabit,
    deleteHabit,
    reactivateHabit,
    reorderHabits,
  } = useClientHabits(client.id, true);

  const {
    data: weekData,
    isLoading: weekLoading,
    error: weekError,
    mutate: mutateWeek,
  } = useHabitsWeek(client.id, weekStart);

  // The summary strip + week tracker render from the separate /habits/weekly
  // read, which the useClientHabits mutators don't revalidate — without this,
  // a created/edited habit only appears after a full page refresh.
  const refreshWeekAfter =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await fn(...args);
      void mutateWeek();
      return result;
    };

  const isInitialLoading = habitsLoading && weekLoading;

  if (isInitialLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#93b0b4]" />
        <p className="text-[13px] text-[#93b0b4]">Loading habits...</p>
      </div>
    );
  }

  if (habitsError && weekError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <p className="text-[14px] font-medium text-[#0c1a1e]">Failed to load habits</p>
        <p className="text-[13px] text-[#93b0b4]">
          {habitsError?.message || "An error occurred"}
        </p>
      </div>
    );
  }

  const summary = weekData?.summary ?? null;

  return (
    // Block flow, not space-y: the week-nav divider owns its own mb-3 (12px
    // below); a space-y margin would collapse against it.
    <div>
      {/* Dark summary strip — hero first, like every other tab (mb-4 = the
          divider spec's 16px above) */}
      <div className="mb-4">
        <HabitsSummaryStrip
          todayCompleted={summary?.todayCompleted ?? null}
          todayTotal={summary?.todayTotal ?? null}
          weeklyRate={summary?.weeklyRate ?? null}
          allHabitsStreak={summary?.allHabitsStreak ?? null}
          activeCount={summary?.activeCount ?? null}
        />
      </div>

      {/* Week-nav divider: nav left in the label slot, Manage Habits right */}
      <HabitsWeekNav
        weekOffset={weekOffset}
        onPrev={() => setWeekOffset((o) => o - 1)}
        onNext={() => setWeekOffset((o) => Math.min(o + 1, 0))}
        weekStart={weekStart}
        weekEnd={weekEnd}
        actions={
          // Quiet divider text action sized to the DividerPager meta (11px,
          // muted) — sans, not mono, per the words-are-sans typography rule.
          // A taller control would grow the row past 24.5px and sink the
          // hairline.
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            disabled={!!habitsError}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[#93b0b4] transition-colors hover:text-[#0d9488] disabled:pointer-events-none disabled:opacity-50"
          >
            <Settings2 className="h-3 w-3" strokeWidth={1.5} />
            Manage habits
          </button>
        }
      />

      {/* Week tracker table */}
      {weekError ? (
        <div className="bg-white rounded-[6px] p-5">
          <div className="h-24 flex flex-col items-center justify-center gap-2">
            <p className="text-[13px] text-[#93b0b4]">Failed to load tracker data</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void mutateWeek()}
              className="text-[12px] border-[rgba(13,148,136,0.08)] text-[#5a7d82]"
            >
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <HabitsWeekTracker
          habits={weekData?.habits ?? []}
          weekDays={weekData?.weekDays ?? []}
          today={today}
          isLoading={weekLoading}
        />
      )}

      {/* Manage drawer */}
      <HabitsManageDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        habits={habits}
        onCreateHabit={refreshWeekAfter(createHabit)}
        onUpdateHabit={refreshWeekAfter(updateHabit)}
        onDeleteHabit={refreshWeekAfter(deleteHabit)}
        onReactivateHabit={refreshWeekAfter(reactivateHabit)}
        onReorderHabits={refreshWeekAfter(reorderHabits)}
      />
    </div>
  );
};
