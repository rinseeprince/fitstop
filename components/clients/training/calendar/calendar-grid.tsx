"use client";

import { memo } from "react";
import { CalendarWeekRow } from "./calendar-week-row";
import { CAL_GRID_COLS } from "./calendar-tokens";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { WeekAction } from "./calendar-week-rail";
import type { TrainingEvent } from "@/types/training";
import type { PhaseStatus } from "@/types/roadmap";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CalendarGridProps = {
  weeks: string[][];
  eventsByDate: Map<string, TrainingEvent[]>;
  editMode: boolean;
  todayDate: string;
  clientToday: string;
  duplicateMode: boolean;
  viewMonth: number;
  viewYear: number;
  phaseByDate: Map<string, PhaseStatus>;
  hasPlan: boolean;
  /** Resolves the single plan a week row belongs to (null = mixed/empty). */
  weekRowPlanId: (days: string[]) => string | null;
  onWeekAction: (weekStartDate: string, action: WeekAction) => void;
  onCellClick: (date: string) => void;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate: (event: TrainingEvent) => void;
  onDelete: (event: TrainingEvent) => void;
};

// The month frame: sticky Mon–Sun header + stacked week rows on the shared
// 42px-rail grid template. The PAGE scrolls (no inner max-height) — the header
// sticks against the page background while the rows flow underneath it.
export const CalendarGrid = memo(function CalendarGrid({
  weeks,
  eventsByDate,
  editMode,
  todayDate,
  clientToday,
  duplicateMode,
  viewMonth,
  viewYear,
  phaseByDate,
  hasPlan,
  weekRowPlanId,
  onWeekAction,
  onCellClick,
  onEventClick,
  onDuplicate,
  onDelete,
}: CalendarGridProps) {
  return (
    <div>
      {/* Sticky weekday header — first cell empty over the rail */}
      <div className={`${CAL_GRID_COLS} sticky top-0 z-20 bg-[#f4f7f6] pb-1`}>
        <div />
        {DAY_LABELS.map((label) => (
          <div key={label} className={`${LABEL_CLASS} py-1 text-center`}>
            {label}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {weeks.map((days, i) => {
          const rowPlanId = weekRowPlanId(days);
          const rowHasEvents = days.some(
            (d) => (eventsByDate.get(d) ?? []).length > 0,
          );
          const showKebab = hasPlan && !!rowPlanId && rowHasEvents;
          const disabledReason = !rowHasEvents
            ? undefined
            : rowPlanId === null
              ? "Mixed plans — use session menu"
              : undefined;
          return (
            <div key={days[0]}>
              <CalendarWeekRow
                days={days}
                weekNumber={i + 1}
                eventsByDate={eventsByDate}
                editMode={editMode}
                todayDate={todayDate}
                clientToday={clientToday}
                duplicateMode={duplicateMode}
                viewMonth={viewMonth}
                viewYear={viewYear}
                phaseByDate={phaseByDate}
                showWeekKebab={showKebab}
                weekActionDisabledReason={disabledReason}
                isLastWeek={i === weeks.length - 1}
                onWeekAction={onWeekAction}
                onCellClick={onCellClick}
                onEventClick={onEventClick}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
