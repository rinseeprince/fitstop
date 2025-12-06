"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WeeklyScheduleItem } from "./weekly-schedule-item";
import type { TrainingSession } from "@/types/training";
import { cn } from "@/lib/utils";

type SortableScheduleItemProps = {
  item: TrainingSession;
  editMode: boolean;
  compact?: boolean;
  onDelete?: () => void;
};

export function SortableScheduleItem({
  item,
  editMode,
  compact,
  onDelete,
}: SortableScheduleItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !editMode,
    data: {
      type: item.sessionType,
      dayOfWeek: item.dayOfWeek,
      item,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        editMode && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50 z-50"
      )}
      {...attributes}
      {...listeners}
    >
      <WeeklyScheduleItem
        item={item}
        editMode={editMode}
        compact={compact}
        onDelete={onDelete}
      />
    </div>
  );
}
