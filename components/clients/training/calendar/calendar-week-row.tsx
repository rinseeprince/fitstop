"use client";

import { memo } from "react";
import { CalendarDayCell } from "./calendar-day-cell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Copy, CopyPlus, Save, Trash2 } from "lucide-react";
import type { TrainingEvent } from "@/types/training";
import type { PhaseStatus } from "@/types/roadmap";

type WeekAction = "duplicate_next" | "duplicate_remaining" | "save_to_library" | "clear";

type CalendarWeekRowProps = {
  days: string[];
  eventsByDate: Map<string, TrainingEvent[]>;
  editMode: boolean;
  todayDate: string;
  duplicateMode: boolean;
  /** Month shown in the grid; days outside it render dimmed. 0-indexed. */
  viewMonth: number;
  viewYear: number;
  /** Per-day phase status for tinting. Keyed by YYYY-MM-DD. */
  phaseByDate?: Map<string, PhaseStatus>;
  /** Whether week-level actions should render. False when no plan or row spans plans. */
  showWeekKebab: boolean;
  weekActionDisabledReason?: string;
  /** For "duplicate to remaining" — end of current plan/phase. */
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
  duplicateMode,
  viewMonth,
  viewYear,
  phaseByDate,
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

  return (
    <div className="flex gap-1">
      {/* Kebab menu column — only rendered in edit mode */}
      {editMode && (
      <div className="w-10 flex-shrink-0 flex flex-col items-center pt-1">
        {showWeekKebab ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-0.5 rounded hover:bg-[rgba(13,148,136,0.05)] transition-colors">
                <MoreVertical className="h-3 w-3 text-[#93b0b4]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {!isLastWeek && (
                <DropdownMenuItem
                  onClick={() => onWeekAction(weekStartDate, "duplicate_next")}
                >
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Duplicate to next week
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onWeekAction(weekStartDate, "duplicate_remaining")}
              >
                <CopyPlus className="h-3.5 w-3.5 mr-2" />
                Duplicate to all remaining
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onWeekAction(weekStartDate, "save_to_library")}
              >
                <Save className="h-3.5 w-3.5 mr-2" />
                Save as plan
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={() => onWeekAction(weekStartDate, "clear")}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Clear week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : weekActionDisabledReason ? (
          <span
            className="text-[10px] text-[#93b0b4] cursor-help"
            title={weekActionDisabledReason}
          >
            —
          </span>
        ) : null}
      </div>
      )}

      {/* Day cells */}
      <div className="flex-1 grid grid-cols-7 gap-1">
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
              isPast={date < todayDate}
              isOutsideMonth={isOutsideMonth}
              phaseStatus={phaseByDate?.get(date) ?? null}
              editMode={editMode}
              duplicateMode={duplicateMode}
              onCellClick={onCellClick}
              onEventClick={onEventClick}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </div>
  );
});
