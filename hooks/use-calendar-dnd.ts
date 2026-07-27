"use client";

import { useState, useCallback } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { getTodayDateString } from "@/lib/date-helpers";
import type { TrainingEvent } from "@/types/training";
import type { KeyedMutator } from "swr";

type UseCalendarDndProps = {
  events: TrainingEvent[];
  clientId: string;
  mutate: KeyedMutator<{ success: boolean; events: TrainingEvent[] }>;
  onLibraryPlanDrop?: (planId: string, startDate: string) => void;
  onLibrarySessionDrop?: (sessionId: string, targetDate: string) => void;
};

export function useCalendarDnd({
  events,
  clientId,
  mutate,
  onLibraryPlanDrop,
  onLibrarySessionDrop,
}: UseCalendarDndProps) {
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const invalidateTrainingData = useInvalidateTrainingData();
  const [activeEvent, setActiveEvent] = useState<TrainingEvent | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      // Skip library items — they don't have a preview in the calendar overlay
      const dataType = event.active.data.current?.type as string | undefined;
      if (dataType === "library-plan" || dataType === "library-session") return;

      const found = events.find((e) => e.id === event.active.id);
      if (found && found.status === "scheduled" && found.date >= getTodayDateString()) {
        setActiveEvent(found);
      }
    },
    [events]
  );

  /**
   * Moves one event and one event only. A drop used to arm a scope dialog which
   * then performed the move; the dialog's second option ("this and all future X
   * sessions") was structurally inert — it matched siblings by
   * `training_session_id`, and placement gives every day its own cloned session
   * row, so the sibling set was always just the dragged event. Every drag paid
   * for a modal that could not do anything the drop had not already decided.
   */
  const performMove = useCallback(
    async (event: TrainingEvent, targetDate: string) => {
      // Optimistic: the card lands under the cursor and stays there.
      await mutate(
        (current) => {
          if (!current) return current;
          return {
            ...current,
            events: current.events.map((e) =>
              e.id === event.id ? { ...e, date: targetDate } : e
            ),
          };
        },
        { revalidate: false }
      );

      try {
        const res = await fetch(
          `/api/clients/${clientId}/training/${event.trainingPlanId}/events/${event.id}/move`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetDate }),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to move event");
        }

        toast({ title: "Session moved" });
        await invalidateTrainingData(clientId);
        void invalidateNutritionCalendar(clientId);
      } catch (error) {
        // Revert by REFETCHING rather than restoring a captured snapshot: with
        // the dialog gone, drags are no longer serialized behind a confirm, and
        // a stale snapshot would undo a second move that had already succeeded.
        await mutate();
        toast({
          title: "Move failed",
          description: error instanceof Error ? error.message : "Failed to move event",
          variant: "destructive",
        });
      }
    },
    [clientId, mutate, invalidateTrainingData, invalidateNutritionCalendar, toast]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveEvent(null);

      if (!over) return;

      const targetDate = over.id as string;
      const today = getTodayDateString();

      // Handle library drops
      const dataType = active.data.current?.type as string | undefined;
      if (dataType === "library-plan") {
        if (targetDate < today) {
          toast({ title: "Cannot place in the past", variant: "destructive" });
          return;
        }
        onLibraryPlanDrop?.(active.data.current?.id as string, targetDate);
        return;
      }
      if (dataType === "library-session") {
        if (targetDate < today) {
          toast({ title: "Cannot place in the past", variant: "destructive" });
          return;
        }
        onLibrarySessionDrop?.(active.data.current?.id as string, targetDate);
        return;
      }

      // Standard event move
      const draggedEvent = events.find((e) => e.id === active.id);
      if (!draggedEvent) return;

      // No-op if dropped on same date
      if (targetDate === draggedEvent.date) return;

      // Only allow moving to future dates
      if (targetDate < today) {
        toast({
          title: "Cannot move to past",
          description: "Events can only be moved to today or future dates.",
          variant: "destructive",
        });
        return;
      }

      void performMove(draggedEvent, targetDate);
    },
    [events, toast, onLibraryPlanDrop, onLibrarySessionDrop, performMove]
  );

  return {
    sensors,
    activeEvent,
    handleDragStart,
    handleDragEnd,
  };
}
