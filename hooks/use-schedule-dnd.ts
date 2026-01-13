"use client";

import { useState, useCallback, useMemo } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useToast } from "@/hooks/use-toast";
import { VALID_DAYS, isDayOfWeek, type DayOfWeek } from "@/lib/constants/days";
import type { TrainingSession, ReorderSessionItem } from "@/types/training";

/**
 * Determines the target day for a dropped item based on the drop target
 */
function determineTargetDay(
  overId: string,
  allItems: TrainingSession[]
): DayOfWeek | null {
  // Dropped directly onto a day cell
  if (isDayOfWeek(overId)) {
    return overId;
  }

  // Dropped onto unassigned area
  if (overId === "unassigned") {
    return null;
  }

  // Dropped onto another item - use that item's day
  const overItem = allItems.find((i) => i.id === overId);
  if (overItem) {
    const dayKey = overItem.dayOfWeek?.toLowerCase();
    if (isDayOfWeek(dayKey)) {
      return dayKey;
    }
  }

  return null;
}

/**
 * Calculates the reorder updates needed for both source and target collections
 */
function calculateReorderUpdates(
  draggedItem: TrainingSession,
  targetDay: DayOfWeek | null,
  overId: string,
  targetItems: TrainingSession[],
  sourceItems: TrainingSession[],
  sourceDay: DayOfWeek | null
): ReorderSessionItem[] {
  const updates: ReorderSessionItem[] = [];
  const activeId = draggedItem.id;

  // Filter out the dragged item and calculate insert position
  const filteredTargetItems = targetItems.filter((i) => i.id !== activeId);
  let insertIndex = filteredTargetItems.length;

  if (overId !== targetDay && overId !== "unassigned") {
    const overIndex = filteredTargetItems.findIndex((i) => i.id === overId);
    if (overIndex >= 0) insertIndex = overIndex;
  }

  // Build new target order with dragged item inserted
  const newTargetItems = [
    ...filteredTargetItems.slice(0, insertIndex),
    draggedItem,
    ...filteredTargetItems.slice(insertIndex),
  ];

  // Add updates for target collection
  newTargetItems.forEach((item, idx) => {
    const currentDay = item.dayOfWeek?.toLowerCase() || null;
    const needsUpdate = item.id === activeId ||
                        item.orderIndex !== idx ||
                        currentDay !== targetDay;

    if (needsUpdate) {
      updates.push({ sessionId: item.id, dayOfWeek: targetDay, orderIndex: idx });
    }
  });

  // Add updates for source collection (if moving between days)
  if (sourceDay !== targetDay) {
    sourceItems
      .filter((i) => i.id !== activeId)
      .forEach((item, idx) => {
        if (item.orderIndex !== idx) {
          updates.push({ sessionId: item.id, dayOfWeek: sourceDay, orderIndex: idx });
        }
      });
  }

  return updates;
}

/**
 * Applies optimistic updates to the items list
 */
function applyOptimisticUpdates(
  allItems: TrainingSession[],
  updates: ReorderSessionItem[]
): TrainingSession[] {
  return allItems.map((item) => {
    const update = updates.find((u) => u.sessionId === item.id);
    if (update) {
      return {
        ...item,
        dayOfWeek: update.dayOfWeek ?? undefined,
        orderIndex: update.orderIndex
      };
    }
    return item;
  });
}

type UseScheduleDndProps = {
  sessions: TrainingSession[];
  activities: TrainingSession[];
  clientId: string;
  planId: string;
  onUpdate: () => void;
};

export function useScheduleDnd({
  sessions,
  activities,
  clientId,
  planId,
  onUpdate,
}: UseScheduleDndProps) {
  const { toast } = useToast();
  const [activeItem, setActiveItem] = useState<TrainingSession | null>(null);
  const [optimisticItems, setOptimisticItems] = useState<TrainingSession[] | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const allItems = optimisticItems || [...sessions, ...activities];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<DayOfWeek, TrainingSession[]>();
    VALID_DAYS.forEach((day) => map.set(day, []));

    allItems.forEach((item) => {
      const dayKey = item.dayOfWeek?.toLowerCase();
      if (isDayOfWeek(dayKey)) {
        map.get(dayKey)!.push(item);
      }
    });

    map.forEach((items) => items.sort((a, b) => a.orderIndex - b.orderIndex));
    return map;
  }, [allItems]);

  const unassignedItems = useMemo(() => {
    return allItems
      .filter((item) => !item.dayOfWeek || !isDayOfWeek(item.dayOfWeek.toLowerCase()))
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [allItems]);

  const handleDeleteActivity = useCallback(async (sessionId: string, name: string) => {
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      const data = await res.json();

      if (data.success) {
        toast({ title: "Activity deleted", description: `${name} removed from plan` });
        onUpdate();
      } else {
        throw new Error(data.error || "Failed to delete activity");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete activity",
        variant: "destructive",
      });
    }
  }, [clientId, planId, toast, onUpdate]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const item = allItems.find((i) => i.id === event.active.id);
    setActiveItem(item || null);
  }, [allItems]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over || isUpdating) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const draggedItem = allItems.find((i) => i.id === activeId);
    if (!draggedItem) return;

    // Determine where the item is being dropped
    const targetDay = determineTargetDay(overId, allItems);
    const sourceDayRaw = draggedItem.dayOfWeek?.toLowerCase();
    const sourceDay: DayOfWeek | null = isDayOfWeek(sourceDayRaw) ? sourceDayRaw : null;

    // Get the collections we're working with
    const targetItems = targetDay ? (itemsByDay.get(targetDay) || []) : unassignedItems;
    const sourceItems = sourceDay ? (itemsByDay.get(sourceDay) || []) : unassignedItems;

    // Calculate all needed reorder updates
    const updates = calculateReorderUpdates(
      draggedItem,
      targetDay,
      overId,
      targetItems,
      sourceItems,
      sourceDay
    );

    if (updates.length === 0) return;

    // Apply optimistic updates for immediate UI feedback
    const updatedItems = applyOptimisticUpdates(allItems, updates);
    setOptimisticItems(updatedItems);
    setIsUpdating(true);

    // Persist changes to the server
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessions: updates }),
        }
      );

      if (!res.ok) throw new Error("Failed to save changes");

      setOptimisticItems(null);
      onUpdate();
    } catch {
      setOptimisticItems(null);
      toast({
        title: "Failed to save changes",
        description: "Your changes have been reverted",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }, [allItems, itemsByDay, unassignedItems, isUpdating, clientId, planId, onUpdate, toast]);

  return {
    sensors,
    activeItem,
    itemsByDay,
    unassignedItems,
    handleDragStart,
    handleDragEnd,
    handleDeleteActivity,
  };
}

