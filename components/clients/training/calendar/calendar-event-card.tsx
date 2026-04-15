"use client";

import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { getTodayDateString } from "@/lib/date-helpers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import type { TrainingEvent, TrainingEventStatus } from "@/types/training";

const STATUS_COLORS: Record<TrainingEventStatus, string> = {
  scheduled: "bg-teal-500",
  completed: "bg-green-500",
  partial: "bg-amber-500",
  missed: "bg-red-500",
  skipped: "bg-gray-400",
};

type CalendarEventCardProps = {
  event: TrainingEvent;
  editMode: boolean;
  isDragging?: boolean;
  onEventClick: (event: TrainingEvent) => void;
  onDuplicate?: (event: TrainingEvent) => void;
  onDelete?: (event: TrainingEvent) => void;
};

export const CalendarEventCard = memo(function CalendarEventCard({
  event,
  editMode,
  isDragging,
  onEventClick,
  onDuplicate,
  onDelete,
}: CalendarEventCardProps) {
  const isFutureScheduled =
    event.status === "scheduled" && event.date >= getTodayDateString();

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editMode && isFutureScheduled ? { ...attributes, ...listeners } : {})}
      className={cn(
        "group flex items-center gap-1.5 rounded-[4px] border border-[rgba(13,148,136,0.08)] bg-white px-1.5 py-1 cursor-pointer transition-all",
        dragging && "opacity-50 z-50",
        editMode && isFutureScheduled && "cursor-grab active:cursor-grabbing"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onEventClick(event);
      }}
    >
      {/* Status dot */}
      <span
        className={cn("w-[5px] h-[5px] rounded-full flex-shrink-0", STATUS_COLORS[event.status])}
      />

      {/* Session name */}
      <span className="text-[11px] text-[#0c1a1e] truncate flex-1 leading-tight">
        {event.sessionName}
      </span>

      {/* Modified indicator */}
      {event.isModified && (
        <Pencil className="h-2.5 w-2.5 text-[#93b0b4] flex-shrink-0" />
      )}

      {/* Action menu - only for future scheduled events in edit mode */}
      {editMode && isFutureScheduled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[rgba(13,148,136,0.05)] transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3 text-[#93b0b4]" />
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
                <Copy className="h-3.5 w-3.5 mr-2" />
                Duplicate
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(event);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
