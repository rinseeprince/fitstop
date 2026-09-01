"use client";

import { cn } from "@/lib/utils";
import {
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

type HabitsSummaryStripProps = {
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
}: {
  label: string;
  value: string;
  sub?: string;
  isLast?: boolean;
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
        {value}
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
      />
      <StatColumn
        label="Weekly Rate"
        value={rateValue}
        sub="this week"
      />
      <StatColumn
        label="Streak"
        value={streakValue}
        sub={allHabitsStreak != null && allHabitsStreak > 0 ? "days — all habits hit" : "days"}
      />
      <StatColumn
        label="Active Habits"
        value={activeValue}
        sub="tracked"
        isLast
      />
    </div>
  );
}
