"use client";

import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { useScheduleDnd, VALID_DAYS } from "@/hooks/use-schedule-dnd";
import { DroppableDayCell } from "./droppable-day-cell";
import { SortableScheduleItem } from "./sortable-schedule-item";
import { WeeklyScheduleItem } from "./weekly-schedule-item";
import type { TrainingSession } from "@/types/training";

type WeeklyScheduleViewProps = {
  sessions: TrainingSession[];
  activities: TrainingSession[];
  editMode: boolean;
  clientId: string;
  planId: string;
  onUpdate: () => void;
};

const DAYS_OF_WEEK = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

export function WeeklyScheduleView({
  sessions,
  activities,
  editMode,
  clientId,
  planId,
  onUpdate,
}: WeeklyScheduleViewProps) {
  const {
    sensors,
    activeItem,
    itemsByDay,
    unassignedItems,
    handleDragStart,
    handleDragEnd,
    handleDeleteActivity,
  } = useScheduleDnd({ sessions, activities, clientId, planId, onUpdate });

  if (!editMode) {
    return (
      <StaticWeeklyView
        itemsByDay={itemsByDay}
        unassignedItems={unassignedItems}
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-7 gap-1">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day.value}
              className="text-center text-sm font-medium text-muted-foreground py-2"
            >
              {day.label}
            </div>
          ))}

          {DAYS_OF_WEEK.map((day) => (
            <DroppableDayCell
              key={day.value}
              dayValue={day.value}
              items={itemsByDay.get(day.value) || []}
              editMode={editMode}
              onDeleteActivity={handleDeleteActivity}
            />
          ))}
        </div>

        <UnassignedSection
          items={unassignedItems}
          editMode={editMode}
          onDeleteActivity={handleDeleteActivity}
        />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div className="shadow-lg rounded-lg opacity-90 ring-2 ring-primary">
            <WeeklyScheduleItem item={activeItem} editMode={false} compact={false} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

type StaticWeeklyViewProps = {
  itemsByDay: Map<string, TrainingSession[]>;
  unassignedItems: TrainingSession[];
};

function StaticWeeklyView({ itemsByDay, unassignedItems }: StaticWeeklyViewProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-1">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day.value}
            className="text-center text-sm font-medium text-muted-foreground py-2"
          >
            {day.label}
          </div>
        ))}

        {DAYS_OF_WEEK.map((day) => {
          const items = itemsByDay.get(day.value) || [];
          const hasItems = items.length > 0;

          return (
            <div
              key={day.value}
              className={cn(
                "min-h-[100px] rounded-lg border p-1.5 transition-colors",
                hasItems ? "bg-background" : "bg-muted/30 border-dashed"
              )}
            >
              {items.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Rest</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {items.map((item) => (
                    <WeeklyScheduleItem key={item.id} item={item} editMode={false} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unassignedItems.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Unassigned Sessions
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {unassignedItems.map((item) => (
              <WeeklyScheduleItem key={item.id} item={item} compact editMode={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type UnassignedSectionProps = {
  items: TrainingSession[];
  editMode: boolean;
  onDeleteActivity: (sessionId: string, name: string) => void;
};

function UnassignedSection({ items, editMode, onDeleteActivity }: UnassignedSectionProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: "unassigned",
    data: { type: "unassigned" },
  });

  const itemIds = items.map((item) => item.id);

  if (items.length === 0 && !editMode) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        Unassigned Sessions
      </h4>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[60px] rounded-lg border border-dashed p-2 transition-all",
          items.length === 0 && "flex items-center justify-center",
          isOver && editMode && "ring-2 ring-primary bg-primary/5"
        )}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {items.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Drag sessions here to unassign
            </span>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {items.map((item) => (
                <SortableScheduleItem
                  key={item.id}
                  item={item}
                  editMode={editMode}
                  compact
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
    </div>
  );
}
