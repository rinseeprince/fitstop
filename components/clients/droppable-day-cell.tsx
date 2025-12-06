"use client";

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

export function DroppableDayCell({
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
        "min-h-[100px] rounded-lg border p-1.5 transition-all",
        hasItems ? "bg-background" : "bg-muted/30 border-dashed",
        isOver && editMode && "ring-2 ring-primary bg-primary/5"
      )}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center min-h-[80px]">
            <span className="text-xs text-muted-foreground">Rest</span>
          </div>
        ) : (
          <div className="space-y-1">
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
}
