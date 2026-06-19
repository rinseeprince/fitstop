"use client";

import { memo } from "react";
import { NutritionCalendarDayCell } from "./nutrition-calendar-day-cell";
import type { NutritionEvent } from "@/types/check-in";
import type { PhaseStatus } from "@/types/roadmap";

type NutritionCalendarWeekRowProps = {
  days: string[];
  eventsByDate: Map<string, NutritionEvent>;
  todayDate: string;
  // Client-local "today" — gates past-vs-future display so it agrees with the
  // server's getClientTodayString guards. Distinct from todayDate (coach device).
  clientToday: string;
  /** Month shown in the grid; days outside it render dimmed. 0-indexed. */
  viewMonth: number;
  viewYear: number;
  /** Per-day phase status for tinting. Keyed by YYYY-MM-DD. */
  phaseByDate?: Map<string, PhaseStatus>;
  includeActivityBurn: boolean;
};

export const NutritionCalendarWeekRow = memo(function NutritionCalendarWeekRow({
  days,
  eventsByDate,
  todayDate,
  clientToday,
  viewMonth,
  viewYear,
  phaseByDate,
  includeActivityBurn,
}: NutritionCalendarWeekRowProps) {
  return (
    <div className="flex gap-1">
      <div className="flex-1 grid grid-cols-7 gap-1">
        {days.map((date) => {
          const dayDate = new Date(date + "T00:00:00");
          const isOutsideMonth =
            dayDate.getFullYear() !== viewYear || dayDate.getMonth() !== viewMonth;
          return (
            <NutritionCalendarDayCell
              key={date}
              date={date}
              dayOfMonth={dayDate.getDate()}
              event={eventsByDate.get(date) ?? null}
              isToday={date === todayDate}
              isPast={date < clientToday}
              isOutsideMonth={isOutsideMonth}
              phaseStatus={phaseByDate?.get(date) ?? null}
              includeActivityBurn={includeActivityBurn}
            />
          );
        })}
      </div>
    </div>
  );
});
