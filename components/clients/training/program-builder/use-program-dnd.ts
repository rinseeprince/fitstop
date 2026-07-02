"use client";

import { useCallback, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { SavedSession } from "@/types/training";
import type { SessionDraft, WeekDraft } from "./program-builder-types";
import { findSession } from "./use-program-builder-state";
import type { ProgramDraft } from "./program-builder-types";

// One DndContext handles all three drag kinds, discriminated by data.type:
// - "week": sortable week rows (vertical reorder)
// - "session": a day cell's session card, dropped on any "day-slot" droppable
//   (move onto rest, swap onto occupied)
// - "library-session": a session-library drawer card, dropped on a REST
//   day-slot only (one session per day-cell is locked — occupied cells are
//   filtered out of collision, so they never highlight and drops are inert)
// A single context works because the gestures can never coexist, and it
// keeps one DragOverlay + portal.

export type WeekDragData = { type: "week"; weekUid: string };
export type SessionDragData = {
  type: "session";
  sessionUid: string;
  fromSlotUid: string;
};
export type LibrarySessionDragData = {
  type: "library-session";
  session: SavedSession;
};
export type SlotDropData = {
  type: "day-slot";
  slotUid: string;
  // Set by day-cell so the library-session collision filter can exclude
  // occupied cells without a draft lookup.
  occupied: boolean;
};

type ActiveDrag =
  | { type: "week"; week: WeekDraft }
  | { type: "session"; session: SessionDraft }
  | { type: "library-session"; session: SavedSession };

type UseProgramDndParams = {
  draft: ProgramDraft | null;
  reorderWeek: (activeUid: string, overUid: string) => void;
  moveSession: (sessionUid: string, targetSlotUid: string) => void;
  placeLibrarySession: (session: SavedSession, targetSlotUid: string) => void;
};

export function useProgramDnd({
  draft,
  reorderWeek,
  moveSession,
  placeLibrarySession,
}: UseProgramDndParams) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  const sensors = useSensors(
    // 4px activation distance so a plain click on a grip doesn't register as a
    // drag (same constraint the draft editor uses).
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Type-aware collision: a dragged session only collides with day-slot
  // droppables (pointerWithin feels right for cell targets, rectIntersection
  // as fallback for keyboard/edge cases); a library card additionally skips
  // occupied slots; a dragged week only collides with week rows.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const activeType = (args.active.data.current as { type?: string } | undefined)?.type;
    if (activeType === "session" || activeType === "library-session") {
      const droppableContainers = args.droppableContainers.filter((c) => {
        const data = c.data.current as
          | { type?: string; occupied?: boolean }
          | undefined;
        if (data?.type !== "day-slot") return false;
        if (activeType === "library-session" && data.occupied) return false;
        return true;
      });
      const within = pointerWithin({ ...args, droppableContainers });
      return within.length > 0
        ? within
        : rectIntersection({ ...args, droppableContainers });
    }
    const droppableContainers = args.droppableContainers.filter(
      (c) => (c.data.current as { type?: string } | undefined)?.type === "week",
    );
    return closestCenter({ ...args, droppableContainers });
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as
        | WeekDragData
        | SessionDragData
        | LibrarySessionDragData
        | undefined;
      if (!data) return;
      if (data.type === "library-session") {
        setActiveDrag({ type: "library-session", session: data.session });
        return;
      }
      if (!draft) return;
      if (data.type === "week") {
        const week = draft.weeks.find((w) => w.uid === data.weekUid);
        if (week) setActiveDrag({ type: "week", week });
        return;
      }
      const session = findSession(draft, data.sessionUid);
      if (session) setActiveDrag({ type: "session", session });
    },
    [draft],
  );

  const handleDragCancel = useCallback(() => setActiveDrag(null), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;
      const activeData = active.data.current as
        | WeekDragData
        | SessionDragData
        | LibrarySessionDragData
        | undefined;
      const overData = over.data.current as
        | { type?: string; slotUid?: string }
        | undefined;
      if (!activeData) return;

      if (activeData.type === "week") {
        if (overData?.type === "week" && active.id !== over.id) {
          reorderWeek(String(active.id), String(over.id));
        }
        return;
      }
      if (overData?.type !== "day-slot") return;
      if (activeData.type === "library-session") {
        placeLibrarySession(activeData.session, String(over.id));
        return;
      }
      moveSession(activeData.sessionUid, String(over.id));
    },
    [reorderWeek, moveSession, placeLibrarySession],
  );

  return {
    sensors,
    collisionDetection,
    activeDrag,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
