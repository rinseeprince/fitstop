import { addDaysToDateString, formatHistoryDate } from "@/lib/date-helpers";
import { scheduleWords, targetWords } from "@/lib/habits/habit-words";
import type { CoachHabit } from "@/types/habits";

/**
 * A habit's History, oldest first: each version in words — its days, then its
 * target, after the run of days it covers ("5 Oct – 18 Oct · Every day · at
 * least 6,000 steps", "From 19 Oct · …") — and, where it stops with nothing
 * straight after, the day it stops: "Stopped 2 Nov" on or before the client's
 * today, "Stops 2 Nov" ahead of it. A habit stopped before its first day
 * ran on no day at all.
 */
export function habitHistoryLines(
  habit: Pick<CoachHabit, "measure" | "unit" | "direction" | "versions">,
  clientToday: string
): string[] {
  if (habit.versions.length === 0) return ["Never ran"];
  const lines: string[] = [];
  habit.versions.forEach((version, i) => {
    const run = version.endsOn
      ? `${formatHistoryDate(version.startsOn)} – ${formatHistoryDate(version.endsOn)}`
      : `From ${formatHistoryDate(version.startsOn)}`;
    const words = [scheduleWords(version), targetWords(habit, version.target)].filter((part): part is string => part !== null);
    lines.push([run, ...words].join(" · "));

    if (version.endsOn === null) return;
    const stopsOn = addDaysToDateString(version.endsOn, 1);
    const next = habit.versions[i + 1];
    if (next && next.startsOn === stopsOn) return;
    lines.push(`${stopsOn <= clientToday ? "Stopped" : "Stops"} ${formatHistoryDate(stopsOn)}`);
  });
  return lines;
}
