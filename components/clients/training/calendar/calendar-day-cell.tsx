"use client";

import { memo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CalendarEventCard } from "./calendar-event-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { TrainingEvent } from "@/types/training";

type CalendarDayCellProps = {
  date: string;
  dayOfMonth: number;
  events: TrainingEvent[];
  isToday: boolean;
  isPast: boolean;
  isOutsideMonth?: boolean;
  editMode: boolean;
  duplicateMode: boolean;
  // Client-local "today" forwarded to the event card's drag/delete gate.
  clientToday: string;
  onCellClick: (date: string) => void;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate: (event: TrainingEvent) => void;
  onDelete: (event: TrainingEvent) => void;
};

const MAX_VISIBLE_EVENTS = 3;

export const CalendarDayCell = memo(function CalendarDayCell({
  date,
  dayOfMonth,
  events,
  isToday,
  isPast,
  isOutsideMonth,
  editMode,
  duplicateMode,
  clientToday,
  onCellClick,
  onEventClick,
  onDuplicate,
  onDelete,
}: CalendarDayCellProps) {
  // Deliberately NOT `disabled: isPast`. A disabled droppable is removed from
  // collision detection entirely, so a drop aimed at a past day could not resolve
  // to it and fell through to whichever cell was nearest — moving the session to
  // a day nobody chose. Registered, the drop lands here and use-calendar-dnd
  // refuses it with a reason. The drag-over highlight below still checks isPast,
  // so a past cell never invites the drop.
  const { isOver, setNodeRef } = useDroppable({ id: date });

  const [overflowOpen, setOverflowOpen] = useState(false);

  const hasOverflow = events.length > MAX_VISIBLE_EVENTS;
  const visibleEvents = hasOverflow ? events.slice(0, MAX_VISIBLE_EVENTS) : events;
  const overflowCount = events.length - MAX_VISIBLE_EVENTS;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative flex min-h-[96px] flex-col gap-1 rounded-[6px] border border-[rgba(13,148,136,0.06)] p-1.5 transition-all",
        isOutsideMonth && "opacity-40",
        isPast && !isOutsideMonth && "opacity-60",
        isToday && "ring-1 ring-[#0d9488]",
        isOver &&
          !isPast &&
          "border-dashed border-[#0d9488] bg-[rgba(13,148,136,0.05)]",
        duplicateMode && !isPast && "cursor-crosshair hover:bg-[rgba(13,148,136,0.05)]"
      )}
      onClick={() => {
        if (duplicateMode && !isPast) {
          onCellClick(date);
        }
      }}
    >
      {/* Date numeral */}
      <span
        className={cn(
          MONO_LABEL_CLASS,
          "self-end normal-case tracking-normal leading-none",
          isToday ? "font-semibold text-[#0d9488]" : "text-[#93b0b4]"
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
          clientToday={clientToday}
          onEventClick={onEventClick}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}

      {/* Overflow — 320px popover listing the full cards (click-through) */}
      {hasOverflow && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                MONO_LABEL_CLASS,
                "self-start rounded px-0.5 normal-case tracking-normal text-[#c2d0cc] transition-colors hover:text-[#0d9488]"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              +{overflowCount} more
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
          >
            <div className="px-3.5 pb-2 pt-3">
              <p className={cn(MONO, "text-sm font-semibold text-[#0c1a1e]")}>
                {format(new Date(date + "T00:00:00"), "EEEE, MMM d")}
              </p>
              <p className={MONO_LABEL_CLASS}>
                {events.length} sessions
              </p>
            </div>
            <div className="max-h-[260px] space-y-1 overflow-y-auto px-1.5 pb-1.5">
              {events.map((e) => (
                <CalendarEventCard
                  key={e.id}
                  event={e}
                  editMode={editMode}
                  clientToday={clientToday}
                  onEventClick={(evt) => {
                    setOverflowOpen(false);
                    onEventClick(evt);
                  }}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Rest day label */}
      {events.length === 0 && !isPast && !isOutsideMonth && (
        <div className="flex flex-1 items-center justify-center">
          <span className={LABEL_CLASS}>Rest</span>
        </div>
      )}
    </div>
  );
});
