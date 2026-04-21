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
import { getTodayDateString } from "@/lib/date-helpers";
import type { TrainingEvent } from "@/types/training";
import type { KeyedMutator } from "swr";

export type PendingMove = {
  event: TrainingEvent;
  sourceDate: string;
  targetDate: string;
};

type UseCalendarDndProps = {
  events: TrainingEvent[];
  eventsByDate: Map<string, TrainingEvent[]>;
  clientId: string;
  mutate: KeyedMutator<{ success: boolean; events: TrainingEvent[] }>;
  onLibraryPlanDrop?: (planId: string, startDate: string) => void;
  onLibrarySessionDrop?: (sessionId: string, targetDate: string) => void;
};

export function useCalendarDnd({
  events,
  eventsByDate,
  clientId,
  mutate,
  onLibraryPlanDrop,
  onLibrarySessionDrop,
}: UseCalendarDndProps) {
  const { toast } = useToast();
  const [activeEvent, setActiveEvent] = useState<TrainingEvent | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isMoving, setIsMoving] = useState(false);

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

      const sourceDate = draggedEvent.date;

      // No-op if dropped on same date
      if (targetDate === sourceDate) return;

      // Only allow moving to future dates
      if (targetDate < today) {
        toast({
          title: "Cannot move to past",
          description: "Events can only be moved to today or future dates.",
          variant: "destructive",
        });
        return;
      }

      // Set pending move to show the scope dialog
      setPendingMove({ event: draggedEvent, sourceDate, targetDate });
    },
    [events, toast, onLibraryPlanDrop, onLibrarySessionDrop]
  );

  const handleMoveConfirm = useCallback(
    async (scope: "single" | "all_future") => {
      if (!pendingMove) return;

      const { event, targetDate } = pendingMove;
      setIsMoving(true);

      // Optimistic update
      const previousEvents = events;
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
            body: JSON.stringify({ targetDate, scope }),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to move event");
        }

        toast({ title: "Event moved" });
        await mutate();
      } catch (error) {
        // Revert optimistic update
        await mutate(
          { success: true, events: previousEvents },
          { revalidate: true }
        );
        toast({
          title: "Move failed",
          description: error instanceof Error ? error.message : "Failed to move event",
          variant: "destructive",
        });
      } finally {
        setIsMoving(false);
        setPendingMove(null);
      }
    },
    [pendingMove, events, clientId, mutate, toast]
  );

  const handleMoveCancel = useCallback(() => {
    setPendingMove(null);
  }, []);

  return {
    sensors,
    activeEvent,
    pendingMove,
    isMoving,
    handleDragStart,
    handleDragEnd,
    handleMoveConfirm,
    handleMoveCancel,
  };
}
