"use client";

import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableScheduleItem } from "./sortable-schedule-item";
import type { TrainingSession } from "@/types/training";
import { cn } from "@/lib/utils";

type DroppableDayCellProps = {
  dayValue: string;
  items: TrainingSession[];
  editMode: boolean;
  onDeleteActivity: (sessionId: string, name: string) => void;
};

export const DroppableDayCell = memo(function DroppableDayCell({
  dayValue,
  items,
  editMode,
  onDeleteActivity,
}: DroppableDayCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: dayValue,
    data: { type: "day", dayValue },
  });

  const hasItems = items.length > 0;
  const itemIds = items.map((item) => item.id);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[140px] rounded-[6px] p-2 transition-all duration-150",
        hasItems
          ? "bg-white border border-[rgba(13,148,136,0.12)]"
          : "bg-transparent border border-dashed border-[rgba(13,148,136,0.12)]",
        isOver && editMode && "ring-2 ring-[#0d9488]/50 bg-[rgba(13,148,136,0.03)]"
      )}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center min-h-[140px]">
            <span className="text-[13px] text-[#93b0b4]">Rest</span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <SortableScheduleItem
                key={item.id}
                item={item}
                editMode={editMode}
                onDelete={
                  item.sessionType === "external_activity"
                    ? () => onDeleteActivity(item.id, item.name)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </SortableContext>
    </div>
  );
});
