"use client";

import { StatBand, type StatBandCell } from "@/components/programs/shared/stat-band";
import { figureFraction } from "@/lib/habits/habit-words";
import type { CoachHabitList, CoachHabitWeek } from "@/types/habits";

/**
 * The Habits tab's summary (docs/newdesignsystem.md → Stat band): This week —
 * the week's met of its planned, "8/13"; Today — today's planned habits done
 * today, on the week holding it; Habits — the habits running on the client's
 * today. A figure with nothing planned is a muted dash; a read in flight is
 * pending text, never a dash. No cell has a line under its value.
 */
export function HabitsStatBand({
  week,
  list,
  weekPending,
  listPending,
}: {
  week: CoachHabitWeek | null;
  list: CoachHabitList | null;
  weekPending: boolean;
  listPending: boolean;
}) {
  const thisWeek = week ? figureFraction(week.totals.met, week.totals.planned) : null;
  const today = week?.today ? figureFraction(week.today.done, week.today.planned) : null;
  const cells: StatBandCell[] = [
    { label: "This week", value: thisWeek ?? "—", valueMuted: thisWeek === null, pending: weekPending, sub: null },
    { label: "Today", value: today ?? "—", valueMuted: today === null, pending: weekPending, sub: null },
    {
      label: "Habits",
      value: list ? String(list.habits.filter((habit) => habit.status === "running").length) : "—",
      valueMuted: list === null,
      pending: listPending,
      sub: null,
    },
  ];
  return <StatBand cells={cells} />;
}
