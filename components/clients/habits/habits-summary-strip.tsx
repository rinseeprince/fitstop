"use client";

import { cn } from "@/lib/utils";
import { TextSkeleton } from "@/components/text-skeleton";
import {
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

type HabitsSummaryStripProps = {
  /** The week read is still in flight: values render as pending text inside
   *  the real elements — a dash is a settled answer, not a loading state. */
  pending?: boolean;
  todayCompleted: number | null;
  todayTotal: number | null;
  weeklyRate: number | null;
  allHabitsStreak: number | null;
  activeCount: number | null;
};

function StatColumn({
  label,
  value,
  sub,
  isLast,
  pending,
}: {
  label: string;
  value: string;
  sub?: string;
  isLast?: boolean;
  /** Value renders as pending text inside the real element; the static sub
   *  copy stays — it describes the slot, not the data. */
  pending?: boolean;
}) {
  return (
    <div
      className={
        isLast
          ? "flex flex-col pl-5"
          : "flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]"
      }
    >
      <p className={STAT_LABEL_DARK_CLASS}>
        {label}
      </p>
      <p className={cn(STAT_VALUE_DARK_CLASS, "text-[28px] leading-tight mt-1")}>
        {pending ? <TextSkeleton className="w-12" /> : value}
      </p>
      {sub && (
        <p className="text-[11px] text-[rgba(255,255,255,0.3)] mt-1">
          {sub}
        </p>
      )}
    </div>
  );
}

export function HabitsSummaryStrip({
  pending = false,
  todayCompleted,
  todayTotal,
  weeklyRate,
  allHabitsStreak,
  activeCount,
}: HabitsSummaryStripProps) {
  const todayValue =
    todayCompleted != null && todayTotal != null
      ? `${todayCompleted}/${todayTotal}`
      : "—";

  const rateValue = weeklyRate != null ? `${weeklyRate}%` : "—";

  const streakValue =
    allHabitsStreak != null
      ? allHabitsStreak >= 90
        ? "90+"
        : String(allHabitsStreak)
      : "—";

  const activeValue = activeCount != null ? String(activeCount) : "—";

  return (
    <div className="bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-4">
      <StatColumn
        label="Today"
        value={todayValue}
        sub="completed"
        pending={pending}
      />
      <StatColumn
        label="Weekly Rate"
        value={rateValue}
        sub="this week"
        pending={pending}
      />
      <StatColumn
        label="Streak"
        value={streakValue}
        sub={allHabitsStreak != null && allHabitsStreak > 0 ? "days — all habits hit" : "days"}
        pending={pending}
      />
      <StatColumn
        label="Active Habits"
        value={activeValue}
        sub="tracked"
        isLast
        pending={pending}
      />
    </div>
  );
}
