"use client";

import { memo } from "react";
import { NutritionCalendarDayCell } from "./nutrition-calendar-day-cell";
import {
  NutritionCalendarWeekRail,
  type NutritionWeekAction,
} from "./nutrition-calendar-week-rail";
import { CAL_GRID_COLS } from "@/components/clients/training/calendar/calendar-tokens";
import { eligibleDatesIn } from "@/utils/nutrition-calendar-selection";
import type { NutritionEvent } from "@/types/check-in";

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
  includeActivityBurn: boolean;
  surplusAsCarbs?: boolean;
  /** Edit mode (◆2) + selection. */
  editMode?: boolean;
  selected?: Set<string>;
  onToggle?: (date: string) => void;
  /** Week-rail kebab: acts on this week's eligible dates. */
  onWeekAction: (eligibleDates: string[], action: NutritionWeekAction) => void;
  isSaving: boolean;
};

export const NutritionCalendarWeekRow = memo(function NutritionCalendarWeekRow({
  days,
  eventsByDate,
  todayDate,
  clientToday,
  viewMonth,
  viewYear,
  includeActivityBurn,
  surplusAsCarbs,
  editMode,
  selected,
  onToggle,
  onWeekAction,
  isSaving,
}: NutritionCalendarWeekRowProps) {
  const weekStartDate = days[0];
  const eligibleDates = eligibleDatesIn(days, eventsByDate, clientToday);

  return (
    <div className={CAL_GRID_COLS}>
      <NutritionCalendarWeekRail
        weekStartDate={weekStartDate}
        showKebab={!!editMode && eligibleDates.length > 0}
        isSaving={isSaving}
        onAction={(action) => onWeekAction(eligibleDates, action)}
      />

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
            includeActivityBurn={includeActivityBurn}
            surplusAsCarbs={surplusAsCarbs}
            editMode={editMode}
            isSelected={selected?.has(date) ?? false}
            onToggle={onToggle}
          />
        );
      })}
    </div>
  );
});
