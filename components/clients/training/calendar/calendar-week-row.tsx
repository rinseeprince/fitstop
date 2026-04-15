"use client";

import { memo } from "react";
import { CalendarDayCell } from "./calendar-day-cell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Copy, CopyPlus, Trash2 } from "lucide-react";
import type { TrainingEvent } from "@/types/training";

type WeekAction = "duplicate_next" | "duplicate_remaining" | "clear";

type CalendarWeekRowProps = {
  weekNumber: number;
  days: string[];
  eventsByDate: Map<string, TrainingEvent[]>;
  editMode: boolean;
  todayDate: string;
  duplicateMode: boolean;
  isLastWeek: boolean;
  onWeekAction: (weekNumber: number, weekStartDate: string, action: WeekAction) => void;
  onCellClick: (date: string) => void;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate: (event: TrainingEvent) => void;
  onDelete: (event: TrainingEvent) => void;
};

export const CalendarWeekRow = memo(function CalendarWeekRow({
  weekNumber,
  days,
  eventsByDate,
  editMode,
  todayDate,
  duplicateMode,
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
      {/* Week label + actions */}
      <div className="w-10 flex-shrink-0 flex flex-col items-center pt-1">
        <span className="text-[10px] font-semibold text-[#93b0b4] leading-none">
          W{weekNumber}
        </span>

        {editMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="mt-1 p-0.5 rounded hover:bg-[rgba(13,148,136,0.05)] transition-colors">
                <MoreVertical className="h-3 w-3 text-[#93b0b4]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {!isLastWeek && (
                <DropdownMenuItem
                  onClick={() => onWeekAction(weekNumber, weekStartDate, "duplicate_next")}
                >
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Duplicate to next week
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onWeekAction(weekNumber, weekStartDate, "duplicate_remaining")}
              >
                <CopyPlus className="h-3.5 w-3.5 mr-2" />
                Duplicate to all remaining
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={() => onWeekAction(weekNumber, weekStartDate, "clear")}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Clear week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Day cells */}
      <div className="flex-1 grid grid-cols-7 gap-1">
        {days.map((date) => {
          const dayDate = new Date(date + "T00:00:00");
          return (
            <CalendarDayCell
              key={date}
              date={date}
              dayOfMonth={dayDate.getDate()}
              events={eventsByDate.get(date) ?? []}
              isToday={date === todayDate}
              isPast={date < todayDate}
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
