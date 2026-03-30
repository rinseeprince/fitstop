"use client";

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
      <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
        {label}
      </p>
      <p className="text-[28px] font-bold leading-tight mt-1 text-white font-mono-display">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">
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
    <div className="bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-4 animate-card-in">
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
