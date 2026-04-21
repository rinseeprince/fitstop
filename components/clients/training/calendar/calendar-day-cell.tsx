"use client";

import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { CalendarEventCard } from "./calendar-event-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TrainingEvent } from "@/types/training";
import type { PhaseStatus } from "@/types/roadmap";

type CalendarDayCellProps = {
  date: string;
  dayOfMonth: number;
  events: TrainingEvent[];
  isToday: boolean;
  isPast: boolean;
  isOutsideMonth?: boolean;
  phaseStatus?: PhaseStatus | null;
  editMode: boolean;
  duplicateMode: boolean;
  onCellClick: (date: string) => void;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate: (event: TrainingEvent) => void;
  onDelete: (event: TrainingEvent) => void;
};

const MAX_VISIBLE_EVENTS = 2;

function phaseTintClass(status: PhaseStatus | null | undefined): string {
  switch (status) {
    case "active":
      return "bg-[rgba(13,148,136,0.06)]";
    case "completed":
      return "bg-[rgba(148,163,184,0.08)]";
    case "planned":
      return "bg-[rgba(59,130,246,0.06)]";
    default:
      return "";
  }
}

export const CalendarDayCell = memo(function CalendarDayCell({
  date,
  dayOfMonth,
  events,
  isToday,
  isPast,
  isOutsideMonth,
  phaseStatus,
  editMode,
  duplicateMode,
  onCellClick,
  onEventClick,
  onDuplicate,
  onDelete,
}: CalendarDayCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: date,
    disabled: isPast,
  });

  const hasOverflow = events.length > MAX_VISIBLE_EVENTS;
  const visibleEvents = hasOverflow ? events.slice(0, MAX_VISIBLE_EVENTS) : events;
  const overflowCount = events.length - MAX_VISIBLE_EVENTS;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[80px] rounded-[4px] border border-[rgba(13,148,136,0.06)] p-1.5 flex flex-col gap-1 relative transition-all",
        phaseTintClass(phaseStatus),
        isOutsideMonth && "opacity-40",
        isPast && !isOutsideMonth && "opacity-60",
        isToday && "ring-2 ring-teal-500",
        isOver && !isPast && "ring-2 ring-teal-500/50 bg-[rgba(13,148,136,0.03)]",
        duplicateMode && !isPast && "cursor-crosshair hover:bg-[rgba(13,148,136,0.05)]"
      )}
      onClick={() => {
        if (duplicateMode && !isPast) {
          onCellClick(date);
        }
      }}
    >
      {/* Date number */}
      <span
        className={cn(
          "text-[10px] font-medium self-end leading-none",
          isToday ? "text-teal-600 font-semibold" : "text-[#93b0b4]"
        )}
      >
        {dayOfMonth}
      </span>

      {/* Events */}
      {visibleEvents.map((event) => (
        <CalendarEventCard
          key={event.id}
          event={event}
          editMode={editMode}
          onEventClick={onEventClick}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}

      {/* Overflow indicator */}
      {hasOverflow && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-[#93b0b4] font-medium cursor-default">
              +{overflowCount} more
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="space-y-1">
              {events.slice(MAX_VISIBLE_EVENTS).map((e) => (
                <p key={e.id} className="text-xs">{e.sessionName}</p>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Rest day label */}
      {events.length === 0 && !isPast && !isOutsideMonth && (
        <span className="text-[10px] text-[#93b0b4] mt-auto">Rest</span>
      )}
    </div>
  );
});
