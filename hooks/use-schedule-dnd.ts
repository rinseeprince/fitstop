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
import type { TrainingSession, ReorderSessionItem } from "@/types/training";

const VALID_DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
];

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
    const map = new Map<string, TrainingSession[]>();
    VALID_DAYS.forEach((day) => map.set(day, []));

    allItems.forEach((item) => {
      const dayKey = item.dayOfWeek?.toLowerCase();
      if (dayKey && VALID_DAYS.includes(dayKey)) {
        map.get(dayKey)!.push(item);
      }
    });

    map.forEach((items) => items.sort((a, b) => a.orderIndex - b.orderIndex));
    return map;
  }, [allItems]);

  const unassignedItems = useMemo(() => {
    return allItems
      .filter((item) => !item.dayOfWeek || !VALID_DAYS.includes(item.dayOfWeek.toLowerCase()))
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

    // Determine target day
    let targetDay: string | null = null;
    if (VALID_DAYS.includes(overId)) {
      targetDay = overId;
    } else if (overId === "unassigned") {
      targetDay = null;
    } else {
      const overItem = allItems.find((i) => i.id === overId);
      if (overItem) {
        targetDay = overItem.dayOfWeek?.toLowerCase() || null;
        if (targetDay && !VALID_DAYS.includes(targetDay)) {
          targetDay = null;
        }
      }
    }

    const targetItems = targetDay ? (itemsByDay.get(targetDay) || []) : unassignedItems;
    const updates: ReorderSessionItem[] = [];

    const filteredTargetItems = targetItems.filter((i) => i.id !== activeId);

    let insertIndex = filteredTargetItems.length;
    if (overId !== targetDay && overId !== "unassigned") {
      const overIndex = filteredTargetItems.findIndex((i) => i.id === overId);
      if (overIndex >= 0) insertIndex = overIndex;
    }

    const newTargetItems = [
      ...filteredTargetItems.slice(0, insertIndex),
      draggedItem,
      ...filteredTargetItems.slice(insertIndex),
    ];

    newTargetItems.forEach((item, idx) => {
      const newDay = targetDay || null;
      const currentDay = item.dayOfWeek?.toLowerCase() || null;

      if (item.id === activeId || item.orderIndex !== idx || currentDay !== newDay) {
        updates.push({ sessionId: item.id, dayOfWeek: newDay, orderIndex: idx });
      }
    });

    const sourceDay = draggedItem.dayOfWeek?.toLowerCase() || null;
    if (sourceDay !== targetDay) {
      const sourceItems = sourceDay ? (itemsByDay.get(sourceDay) || []) : unassignedItems;
      sourceItems
        .filter((i) => i.id !== activeId)
        .forEach((item, idx) => {
          if (item.orderIndex !== idx) {
            updates.push({ sessionId: item.id, dayOfWeek: sourceDay, orderIndex: idx });
          }
        });
    }

    if (updates.length === 0) return;

    const updatedItems = allItems.map((item) => {
      const update = updates.find((u) => u.sessionId === item.id);
      if (update) {
        return { ...item, dayOfWeek: update.dayOfWeek ?? undefined, orderIndex: update.orderIndex };
      }
      return item;
    });

    setOptimisticItems(updatedItems);
    setIsUpdating(true);

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

export { VALID_DAYS };
