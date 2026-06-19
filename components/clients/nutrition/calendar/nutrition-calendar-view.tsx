"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useNutritionCalendarEvents } from "@/hooks/use-nutrition-calendar-events";
import { NutritionCalendarWeekRow } from "./nutrition-calendar-week-row";
import {
  getTodayDateString,
  getTodayDateStringInTimezone,
  getDateString,
} from "@/lib/date-helpers";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import type { Phase, PhaseStatus } from "@/types/roadmap";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Returns the Monday on or before the given date (local time). */
function mondayOnOrBefore(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay(); // 0 = Sun
  const offset = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + offset);
  return result;
}

/** Returns the Sunday on or after the given date (local time). */
function sundayOnOrAfter(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay();
  const offset = day === 0 ? 0 : 7 - day;
  result.setDate(result.getDate() + offset);
  return result;
}

function buildWeeks(gridStart: Date, gridEnd: Date): string[][] {
  const weeks: string[][] = [];
  const current = new Date(gridStart);
  while (current <= gridEnd) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(getDateString(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type NutritionCalendarViewProps = {
  clientId: string;
  phases: Phase[];
  clientTimezone?: string;
  /** Activity-burn toggle, so calendar totals match the rest of the builder. */
  includeActivityBurn: boolean;
};

export function NutritionCalendarView({
  clientId,
  phases,
  clientTimezone,
  includeActivityBurn,
}: NutritionCalendarViewProps) {
  const todayDate = getTodayDateString();
  // Past/future display is judged on the CLIENT's calendar so it agrees with the
  // server's getClientTodayString edit guards; the visual today ring stays on the
  // coach's device (todayDate). 'UTC' is the never-synced sentinel -> fall back to
  // device today (NOT getTodayDateStringInTimezone('UTC'), which would be UTC today).
  const clientToday =
    clientTimezone && clientTimezone !== "UTC"
      ? getTodayDateStringInTimezone(clientTimezone)
      : todayDate;

  const todayRowRef = useRef<HTMLDivElement>(null);

  // Month nav state — defaults to the current month
  const [viewMonth, setViewMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  // Compute grid range for the viewed month
  const { weeks, startDate, endDate } = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
    const lastOfMonth = new Date(viewMonth.year, viewMonth.month + 1, 0);
    const gs = mondayOnOrBefore(firstOfMonth);
    const ge = sundayOnOrAfter(lastOfMonth);
    return {
      weeks: buildWeeks(gs, ge),
      startDate: getDateString(gs),
      endDate: getDateString(ge),
    };
  }, [viewMonth]);

  const { eventsByDate, isLoading } = useNutritionCalendarEvents(clientId, startDate, endDate);

  // Build per-day phase status map for tinting
  const phaseByDate = useMemo(() => {
    const map = new Map<string, PhaseStatus>();
    if (phases.length === 0) return map;
    const phasesSorted = [...phases].sort((a, b) =>
      (a.startDate ?? "").localeCompare(b.startDate ?? "")
    );
    for (const week of weeks) {
      for (const date of week) {
        for (const phase of phasesSorted) {
          const start = phase.startDate;
          const end = phase.endDate;
          if (start && end && date >= start && date <= end) {
            map.set(date, phase.status);
            break;
          }
        }
      }
    }
    return map;
  }, [phases, weeks]);

  // Scroll today row into view when the viewed month contains today
  useEffect(() => {
    const viewingCurrentMonth =
      new Date().getFullYear() === viewMonth.year &&
      new Date().getMonth() === viewMonth.month;
    if (viewingCurrentMonth && todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isLoading, viewMonth]);

  const monthLabel = format(new Date(viewMonth.year, viewMonth.month, 1), "MMMM yyyy");

  const goPrevMonth = () =>
    setViewMonth(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );
  const goNextMonth = () =>
    setViewMonth(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );
  const goToday = () => {
    const today = new Date();
    setViewMonth({ year: today.getFullYear(), month: today.getMonth() });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Month nav toolbar */}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={goPrevMonth}
          aria-label="Previous month"
          className="p-1 rounded hover:bg-[rgba(13,148,136,0.05)] transition-colors"
        >
          <ChevronLeft className="h-4 w-4 text-[#5a7d82]" />
        </button>
        <span className="text-[13px] font-semibold text-[#0c1a1e] min-w-[120px] text-center">
          {monthLabel}
        </span>
        <button
          onClick={goNextMonth}
          aria-label="Next month"
          className="p-1 rounded hover:bg-[rgba(13,148,136,0.05)] transition-colors"
        >
          <ChevronRight className="h-4 w-4 text-[#5a7d82]" />
        </button>
        <button
          onClick={goToday}
          className="text-[11px] font-medium text-[#5a7d82] hover:text-[#0c1a1e] px-2 py-1 rounded transition-colors"
        >
          Today
        </button>

        <div className="ml-auto flex items-center gap-2">
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#93b0b4]" />}
        </div>
      </div>

      {/* Day headers */}
      <div className="flex gap-1">
        <div className="flex-1 grid grid-cols-7 gap-1">
          {DAY_LABELS.map((label) => (
            <div
              key={label}
              className="text-center text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium py-1"
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Week rows */}
      <div className="flex flex-col gap-1 max-h-[600px] overflow-y-auto">
        {weeks.map((days) => {
          const containsToday = days.includes(todayDate);
          return (
            <div key={days[0]} ref={containsToday ? todayRowRef : undefined}>
              <NutritionCalendarWeekRow
                days={days}
                eventsByDate={eventsByDate}
                todayDate={todayDate}
                clientToday={clientToday}
                viewMonth={viewMonth.month}
                viewYear={viewMonth.year}
                phaseByDate={phaseByDate}
                includeActivityBurn={includeActivityBurn}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
