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
import type { Client } from "@/types/check-in";

type HabitsTabContentProps = {
  client: Client;
  onUpdate?: () => void;
};

export const HabitsTabContent = ({ client }: HabitsTabContentProps) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const today = useMemo(() => getTodayDateString(), []);
  const checkInDay = client.expectedCheckInDay ?? null;

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
  } = useHabitsWeek(client.id, weekStart);

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
    <div className="space-y-4">
      {/* Week nav + Manage button on same row */}
      <div className="flex items-center justify-between">
        <HabitsWeekNav
          weekOffset={weekOffset}
          onPrev={() => setWeekOffset((o) => o - 1)}
          onNext={() => setWeekOffset((o) => Math.min(o + 1, 0))}
          weekStart={weekStart}
          weekEnd={weekEnd}
        />
        <Button
          onClick={() => setDrawerOpen(true)}
          variant="outline"
          size="sm"
          className="border-[rgba(13,148,136,0.08)] text-[#5a7d82] text-[12px] font-medium hover:bg-[rgba(0,0,0,0.02)]"
          disabled={!!habitsError}
        >
          <Settings2 className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
          Manage Habits
        </Button>
      </div>

      {/* Dark summary strip */}
      <HabitsSummaryStrip
        todayCompleted={summary?.todayCompleted ?? null}
        todayTotal={summary?.todayTotal ?? null}
        weeklyRate={summary?.weeklyRate ?? null}
        allHabitsStreak={summary?.allHabitsStreak ?? null}
        activeCount={summary?.activeCount ?? null}
      />

      {/* Week tracker table */}
      {weekError ? (
        <div className="bg-white rounded-[6px] p-5">
          <div className="h-24 flex flex-col items-center justify-center gap-2">
            <p className="text-[13px] text-[#93b0b4]">Failed to load tracker data</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset(weekOffset)}
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
        clientId={client.id}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        habits={habits}
        onCreateHabit={createHabit}
        onUpdateHabit={updateHabit}
        onDeleteHabit={deleteHabit}
        onReactivateHabit={reactivateHabit}
        onReorderHabits={reorderHabits}
      />
    </div>
  );
};
