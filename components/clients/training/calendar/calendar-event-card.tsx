"use client";

import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import {
  LABEL_CLASS,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { STATUS_THUMB } from "./calendar-tokens";
import type { TrainingEvent } from "@/types/training";

type CalendarEventCardProps = {
  event: TrainingEvent;
  editMode: boolean;
  // Client-local "today" — gating must agree with the 7.82 server move/delete
  // guards (which anchor on the client's tz), not the coach's device clock.
  clientToday: string;
  isDragging?: boolean;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate?: (event: TrainingEvent) => void;
  onDelete?: (event: TrainingEvent) => void;
};

// Builder card language for one calendar event: white card, teal-tinted
// border, per-status thumb (calendar-tokens), mono meta row. Structural
// contract (calendar-event-card.test.tsx relies on it): the root stays a
// <div> (dnd-kit stamps role="button" on it when draggable) and the kebab
// trigger is the ONLY real <button> element, gated by editMode +
// isFutureScheduled exactly like the drag.
export const CalendarEventCard = memo(function CalendarEventCard({
  event,
  editMode,
  clientToday,
  isDragging,
  onEventClick,
  onDuplicate,
  onDelete,
}: CalendarEventCardProps) {
  const isFutureScheduled =
    event.status === "scheduled" && event.date >= clientToday;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: localIsDragging,
  } = useDraggable({
    id: event.id,
    disabled: !editMode || !isFutureScheduled,
    data: { event },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const dragging = isDragging || localIsDragging;
  const thumb = STATUS_THUMB[event.status];
  const ThumbIcon = thumb.icon;
  const surplus = event.calorieSurplusPercentage;
  const hasMetaRow = Boolean(event.sessionFocus) || surplus != null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editMode && isFutureScheduled ? { ...attributes, ...listeners } : {})}
      className={cn(
        "group flex cursor-pointer flex-col gap-1 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white px-1.5 py-1.5 transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
        thumb.cardClass,
        dragging && "z-50 opacity-50",
        editMode && isFutureScheduled && "cursor-grab active:cursor-grabbing"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onEventClick(event);
      }}
    >
      <div className="flex items-center gap-1.5">
        {/* Status thumb */}
        <span
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-[6px]",
            thumb.bg
          )}
        >
          <ThumbIcon
            className={cn("h-3 w-3", thumb.iconClass)}
            strokeWidth={thumb.strokeWidth}
          />
        </span>

        {/* Session name */}
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight text-[#0c1a1e]">
          {event.sessionName}
        </span>

        {/* Modified indicator */}
        {event.isModified && (
          <Pencil className="h-2.5 w-2.5 shrink-0 text-[#93b0b4]" strokeWidth={1.5} />
        )}

        {/* Action menu - only for future scheduled events in edit mode */}
        {editMode && isFutureScheduled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Event actions"
                className="rounded p-0.5 text-[#93b0b4] opacity-0 transition-opacity hover:bg-[rgba(13,148,136,0.08)] group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {onDuplicate && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(event);
                  }}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Duplicate
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  className="text-[#c06060] focus:text-[#c06060]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(event);
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Receipt: the log was attributed to this (prescribed) day but performed
          on another — an alternative session. Says where, changes nothing. */}
      {event.loggedOn && event.loggedOn !== event.date && (
        <div className="pl-[26px]">
          <span className={cn(LABEL_CLASS, "normal-case tracking-normal text-[#93b0b4]")}>
            Done{" "}
          </span>
          <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal text-[#93b0b4]")}>
            {formatDoneOn(event.loggedOn)}
          </span>
        </div>
      )}

      {/* Mono meta row — focus left, surplus right */}
      {hasMetaRow && (
        <div className="flex items-center justify-between gap-1 pl-[26px]">
          <span className={cn(LABEL_CLASS, "min-w-0 truncate normal-case tracking-normal")}>
            {event.sessionFocus ?? ""}
          </span>
          {surplus != null && (
            <span className={cn(MONO_LABEL_CLASS, "shrink-0 normal-case tracking-normal text-[#0d9488]")}>
              +{surplus}%
            </span>
          )}
        </div>
      )}
    </div>
  );
});

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Tue 25" — weekday + day-of-month of a YYYY-MM-DD. Built by hand so the
 *  order is fixed; `toLocaleDateString` puts the day first in some locales. */
function formatDoneOn(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return dateStr;
  const [, y, mo, d] = m;
  const local = new Date(Number(y), Number(mo) - 1, Number(d));
  return `${WEEKDAY_SHORT[local.getDay()]} ${local.getDate()}`;
}
