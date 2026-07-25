"use client";

import { memo } from "react";
import { CalendarDayCell } from "./calendar-day-cell";
import { CalendarWeekRail, type WeekAction } from "./calendar-week-rail";
import { CAL_GRID_COLS } from "./calendar-tokens";
import type { TrainingEvent } from "@/types/training";

type CalendarWeekRowProps = {
  days: string[];
  eventsByDate: Map<string, TrainingEvent[]>;
  editMode: boolean;
  todayDate: string;
  // Client-local "today" for drag/delete gating (matches the 7.82 server guards).
  // Distinct from todayDate, which drives the coach-device visual today ring.
  clientToday: string;
  duplicateMode: boolean;
  /** Month shown in the grid; days outside it render dimmed. 0-indexed. */
  viewMonth: number;
  viewYear: number;
  /** Whether week-level actions should render. False when no plan or row spans plans. */
  showWeekKebab: boolean;
  weekActionDisabledReason?: string;
  /** For "duplicate to remaining" — end of the current plan. */
  isLastWeek: boolean;
  onWeekAction: (weekStartDate: string, action: WeekAction) => void;
  onCellClick: (date: string) => void;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate: (event: TrainingEvent) => void;
  onDelete: (event: TrainingEvent) => void;
};

export const CalendarWeekRow = memo(function CalendarWeekRow({
  days,
  eventsByDate,
  editMode,
  todayDate,
  clientToday,
  duplicateMode,
  viewMonth,
  viewYear,
  showWeekKebab,
  weekActionDisabledReason,
  isLastWeek,
  onWeekAction,
  onCellClick,
  onEventClick,
  onDuplicate,
  onDelete,
}: CalendarWeekRowProps) {
  const weekStartDate = days[0];
  const sessionCount = days.reduce(
    (sum, date) => sum + (eventsByDate.get(date)?.length ?? 0),
    0,
  );

  return (
    <div className={CAL_GRID_COLS}>
      <CalendarWeekRail
        weekStartDate={weekStartDate}
        sessionCount={sessionCount}
        editMode={editMode}
        showKebab={showWeekKebab}
        disabledReason={weekActionDisabledReason}
        isLastWeek={isLastWeek}
        onAction={(action) => onWeekAction(weekStartDate, action)}
      />

      {days.map((date) => {
        const dayDate = new Date(date + "T00:00:00");
        const isOutsideMonth =
          dayDate.getFullYear() !== viewYear || dayDate.getMonth() !== viewMonth;
        return (
          <CalendarDayCell
            key={date}
            date={date}
            dayOfMonth={dayDate.getDate()}
            events={eventsByDate.get(date) ?? []}
            isToday={date === todayDate}
            isPast={date < clientToday}
            isOutsideMonth={isOutsideMonth}
            editMode={editMode}
            duplicateMode={duplicateMode}
            clientToday={clientToday}
            onCellClick={onCellClick}
            onEventClick={onEventClick}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
});
