"use client";

import { MONO, TEXT_MUTED } from "@/components/clients/training/program-builder/builder-tokens";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { weekFigurePercent, weekFigureWords } from "@/lib/habits/habit-words";
import { cn } from "@/lib/utils";
import type { HabitWeekSpan } from "@/types/habits";

/** What a week's column says when pointed at or read aloud. */
function weekLabel(week: HabitWeekSpan, isThisWeek: boolean): string {
  const when = isThisWeek ? "This week" : `Week of ${formatDateOnlyShort(week.start)}`;
  return `${when}: ${week.planned === 0 ? "nothing planned" : weekFigureWords(week)}`;
}

/**
 * A habit's recent weeks as bars, oldest first, the last this week (the
 * server's weeks, on the client's calendar). Each column is one week's met of
 * its planned: a track the height of what was planned, filled to what was met,
 * so weeks that asked for different numbers read alike. A week that planned
 * nothing has no track. One series in the brand teal, no legend (the card's
 * name says what it is); each column names its week and figure, and the axis
 * names the first week and this one.
 */
export function HabitWeekBars({ weeks }: { weeks: HabitWeekSpan[] }) {
  if (weeks.length === 0) return null;
  const last = weeks.length - 1;

  return (
    <div>
      <div className="flex h-12 items-end gap-0.5 border-b border-[rgba(13,148,136,0.08)]">
        {weeks.map((week, index) => {
          const percent = weekFigurePercent(week);
          const label = weekLabel(week, index === last);
          return (
            <div key={week.start} role="img" aria-label={label} title={label} className="flex h-full flex-1 items-end justify-center">
              {percent === null ? null : (
                <div className="relative h-full w-4 rounded-t-[4px] bg-[rgba(13,148,136,0.08)]">
                  <div className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-[#0d9488]" style={{ height: `${percent}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px]">
        <span className={cn(MONO, TEXT_MUTED)}>{formatDateOnlyShort(weeks[0].start)}</span>
        <span className={TEXT_MUTED}>This week</span>
      </div>
    </div>
  );
}
