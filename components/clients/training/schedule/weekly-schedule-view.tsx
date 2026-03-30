"use client";

import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { DAYS_OF_WEEK } from "@/lib/constants/days";
import { useScheduleDnd } from "@/hooks/use-schedule-dnd";
import { DroppableDayCell } from "./droppable-day-cell";
import { DayHeadersGrid } from "./day-headers-grid";
import { SortableScheduleItem } from "./sortable-schedule-item";
import { WeeklyScheduleItem } from "./weekly-schedule-item";
import { Clock, List } from "lucide-react";
import type { TrainingSession } from "@/types/training";

type WeeklyScheduleViewProps = {
  sessions: TrainingSession[];
  activities: TrainingSession[];
  editMode: boolean;
  clientId: string;
  planId: string;
  onUpdate: () => void;
};

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
      <div className="space-y-2">
        <DayHeadersGrid />

        {/* Day cards */}
        <div className="grid grid-cols-7 gap-2">
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
          <div className="shadow-md rounded-[6px] opacity-90 ring-2 ring-[#0d9488]">
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
    <div className="space-y-2">
      <DayHeadersGrid />

      {/* Day cards */}
      <div className="grid grid-cols-7 gap-2">
        {DAYS_OF_WEEK.map((day, index) => {
          const items = itemsByDay.get(day.value) || [];
          const hasItems = items.length > 0;

          // For training days, use the first training session for the card display
          const primarySession = hasItems
            ? items.find((i) => i.sessionType === "training") || items[0]
            : null;

          const totalExercises = items.reduce(
            (sum, s) => sum + (s.exercises?.length || 0),
            0
          );
          const totalDuration = items.reduce(
            (sum, s) => sum + (s.estimatedDurationMinutes || 0),
            0
          );

          return (
            <div
              key={day.value}
              className={cn(
                "min-h-[140px] rounded-[6px] p-3 flex flex-col justify-between transition-all duration-150 animate-card-in",
                hasItems
                  ? "bg-white border border-[rgba(13,148,136,0.12)] hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(13,148,136,0.12)] cursor-pointer"
                  : "bg-transparent border border-dashed border-[rgba(13,148,136,0.12)] hover:bg-[rgba(13,148,136,0.03)]"
              )}
              style={{ animationDelay: `${index * 0.04}s` }}
            >
              {hasItems ? (
                <>
                  {/* Top section */}
                  <div>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] uppercase font-semibold bg-[#0d9488] text-white">
                      Train
                    </span>
                    {primarySession && (
                      <>
                        <p className="text-[14px] font-semibold text-[#0c1a1e] mt-2 leading-tight truncate">
                          {primarySession.name}
                        </p>
                        {primarySession.focus && (
                          <p className="text-[11px] text-[#93b0b4] mt-0.5 truncate">
                            {primarySession.focus}
                          </p>
                        )}
                      </>
                    )}
                    {items.length > 1 && (
                      <p className="text-[10px] text-[#93b0b4] mt-1">
                        +{items.length - 1} more
                      </p>
                    )}
                  </div>
                  {/* Footer */}
                  <div className="flex items-center gap-2 mt-2">
                    {totalDuration > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-[#93b0b4] font-mono-display">
                        <Clock className="h-3 w-3" />
                        {totalDuration}m
                      </span>
                    )}
                    {totalExercises > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-[#93b0b4] font-mono-display">
                        <List className="h-3 w-3" />
                        {totalExercises}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] uppercase font-semibold bg-[#f0f5f4] text-[#93b0b4]">
                      Rest
                    </span>
                    <p className="text-[13px] text-[#93b0b4] mt-2">Rest Day</p>
                  </div>
                  <span className="text-[11px] text-[#93b0b4] font-mono-display">
                    —
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {unassignedItems.length > 0 && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-3">
            <span className="text-[10.5px] uppercase tracking-[0.07em] text-[#93b0b4] font-semibold whitespace-nowrap">
              Unassigned Sessions
            </span>
            <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
          </div>
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
    <div className="space-y-2 mt-4">
      <div className="flex items-center gap-3">
        <span className="text-[10.5px] uppercase tracking-[0.07em] text-[#93b0b4] font-semibold whitespace-nowrap">
          Unassigned Sessions
        </span>
        <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[60px] rounded-[6px] p-3 transition-all duration-150",
          items.length === 0 && "flex items-center justify-center bg-transparent border border-dashed border-[rgba(13,148,136,0.12)]",
          items.length > 0 && "bg-white border border-[rgba(13,148,136,0.12)]",
          isOver && editMode && "ring-2 ring-[#0d9488]/50 bg-[rgba(13,148,136,0.03)]"
        )}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {items.length === 0 ? (
            <span className="text-xs text-[#93b0b4]">
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
