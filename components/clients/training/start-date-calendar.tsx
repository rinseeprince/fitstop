"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { monthOf, monthPage, shiftMonth } from "@/lib/month-grid";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const NAV_BUTTON =
  "rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488] disabled:cursor-not-allowed disabled:text-[#d5e0dd]";

type StartDateCalendarProps = {
  /** The program's current start, filled. */
  selected: string;
  /** The client's today, ringed. */
  today: string;
  /** The first day that can be picked: every day before it is greyed. */
  min: string;
  onPick: (date: string) => void;
};

/** "Wednesday 23 September 2026", from a YYYY-MM-DD calendar date. */
function dayName(date: string): string {
  return format(new Date(`${date}T00:00:00`), "EEEE d MMMM yyyy");
}

/**
 * A month calendar for a program's start, Monday first like the coach
 * calendar. It opens on the current start's month; the days before `min` are
 * greyed and can't be picked, and the months before `min`'s can't be reached,
 * since every day in them would be. The page is always six weeks, so paging
 * never changes its height.
 */
export function StartDateCalendar({ selected, today, min, onPick }: StartDateCalendarProps) {
  const [month, setMonth] = useState(() => monthOf(selected));

  return (
    <div className="w-[252px]">
      <div className="mb-2 flex items-center justify-between">
        <span className={cn(MONO_LABEL_CLASS, "text-[11px]")}>
          {format(new Date(`${month}T00:00:00`), "MMM yyyy")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={month <= monthOf(min)}
            onClick={() => setMonth(shiftMonth(month, -1))}
            className={cn(NAV_BUTTON, FOCUS_RING)}
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className={cn(NAV_BUTTON, FOCUS_RING)}
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((weekday, i) => (
          <span key={`weekday-${i}`} className={cn(LABEL_CLASS, "grid h-6 place-items-center")}>
            {weekday}
          </span>
        ))}
        {monthPage(month).map((date, cell) => {
          if (date === null) return <span key={`blank-${cell}`} />;
          const isSelected = date === selected;
          const isToday = date === today;
          const tooEarly = date < min;
          return (
            <button
              key={date}
              type="button"
              disabled={tooEarly}
              aria-label={`${dayName(date)}${isSelected ? ", current start" : ""}${isToday ? ", today" : ""}`}
              onClick={() => onPick(date)}
              className={cn(
                MONO,
                "grid h-8 w-8 place-items-center rounded-[4px] text-[12px] transition-colors",
                FOCUS_RING,
                isSelected
                  ? "bg-[#0d9488] font-semibold text-white hover:bg-[#0b7f75]"
                  : tooEarly
                    ? "cursor-not-allowed text-[#d5e0dd]"
                    : "text-[#0c1a1e] hover:bg-[rgba(13,148,136,0.08)] hover:text-[#0a5c55]",
                isToday && !isSelected && "ring-1 ring-inset ring-[#0d9488]",
              )}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
