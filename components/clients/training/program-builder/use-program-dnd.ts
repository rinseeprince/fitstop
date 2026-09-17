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
import type { Exercise, SavedSession } from "@/types/training";
import type { SessionDraft, WeekDraft } from "./program-builder-types";
import { findSession } from "./use-program-builder-state";
import type { ProgramDraft } from "./program-builder-types";

// One DndContext handles all four drag kinds, discriminated by data.type. A
// day a drag can't land on is filtered out of collision (slotAcceptsDrag), so
// it never highlights and a drop there is inert:
// - "week": sortable week rows (vertical reorder)
// - "session": one session card of a day cell, dropped on a "day-slot"
//   droppable: onto a rest day it moves; onto a day holding one session, when
//   it is the only session on its own day, the two swap
// - "library-session": a library-panel session card, dropped on a REST
//   day-slot only
// - "library-exercise": a library-panel exercise card, dropped on a day-slot
//   holding exactly ONE session — it appends to that session (a rest day has
//   none to append to; on a day holding several the coach adds it inside the
//   session they mean)
// A single context works because the gestures can never coexist, and it
// keeps one DragOverlay + portal.

export type WeekDragData = { type: "week"; weekUid: string };
export type SessionDragData = {
  type: "session";
  sessionUid: string;
  fromSlotUid: string;
  /** Whether the session is the only one on its day — only then may it swap. */
  aloneOnDay: boolean;
};
export type LibrarySessionDragData = {
  type: "library-session";
  session: SavedSession;
};
export type LibraryExerciseDragData = {
  type: "library-exercise";
  exercise: Exercise;
};
export type SlotDropData = {
  type: "day-slot";
  slotUid: string;
  // Set by day-cell so the collision filters can judge a day without a draft
  // lookup: how many sessions it holds.
  sessionCount: number;
};

// A week is drag-locked when any of its slots is history (placed-plan target).
function weekIsLocked(
  draft: ProgramDraft | null,
  lockedSlotUids: ReadonlySet<string> | undefined,
  weekUid: string,
): boolean {
  if (!draft || !lockedSlotUids) return false;
  const week = draft.weeks.find((w) => w.uid === weekUid);
  return week != null && week.days.some((slot) => lockedSlotUids.has(slot.uid));
}

type ActiveDrag =
  | { type: "week"; week: WeekDraft }
  | { type: "session"; session: SessionDraft }
  | { type: "library-session"; session: SavedSession }
  | { type: "library-exercise"; exercise: Exercise };

// Which day-slot droppables a drag may collide with — pure so it's
// unit-testable without dnd-kit geometry. A session hits a rest slot, or a
// slot holding one session when it is alone on its own day (the swap); a
// library-session only REST slots; a library-exercise only a slot holding
// exactly one session. A locked slot (placed-plan history) accepts nothing.
export function slotAcceptsDrag(
  active: { type?: string; aloneOnDay?: boolean },
  slot: { type?: string; sessionCount?: number; slotUid?: string },
  lockedSlotUids?: ReadonlySet<string>,
): boolean {
  if (slot.type !== "day-slot") return false;
  if (slot.slotUid && lockedSlotUids?.has(slot.slotUid)) return false;
  const sessionCount = slot.sessionCount ?? 0;
  switch (active.type) {
    case "session":
      return sessionCount === 0 || (sessionCount === 1 && active.aloneOnDay === true);
    case "library-session":
      return sessionCount === 0;
    case "library-exercise":
      return sessionCount === 1;
    default:
      return false;
  }
}

type UseProgramDndParams = {
  draft: ProgramDraft | null;
  reorderWeek: (activeUid: string, overUid: string) => void;
  moveSession: (sessionUid: string, targetSlotUid: string) => void;
  placeLibrarySession: (session: SavedSession, targetSlotUid: string) => void;
  placeLibraryExercise: (exercise: Exercise, targetSlotUid: string) => void;
  // Placed-plan target: locked slots never collide or accept drops, and weeks
  // touching history are excluded from week reordering.
  lockedSlotUids?: ReadonlySet<string>;
};

export function useProgramDnd({
  draft,
  reorderWeek,
  moveSession,
  placeLibrarySession,
  placeLibraryExercise,
  lockedSlotUids,
}: UseProgramDndParams) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  const sensors = useSensors(
    // 4px activation distance so a plain click on a grip doesn't register as a
    // drag (same constraint the draft editor uses).
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Type-aware collision: a dragged session or library card only collides
  // with the day-slot droppables slotAcceptsDrag lets it land on
  // (pointerWithin feels right for cell targets, rectIntersection as fallback
  // for keyboard/edge cases); a dragged week only collides with week rows.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const active =
        (args.active.data.current as { type?: string; aloneOnDay?: boolean } | undefined) ?? {};
      if (
        active.type === "session" ||
        active.type === "library-session" ||
        active.type === "library-exercise"
      ) {
        const droppableContainers = args.droppableContainers.filter((c) =>
          slotAcceptsDrag(
            active,
            (c.data.current as { type?: string; sessionCount?: number; slotUid?: string } | undefined) ?? {},
            lockedSlotUids,
          ),
        );
        const within = pointerWithin({ ...args, droppableContainers });
        return within.length > 0
          ? within
          : rectIntersection({ ...args, droppableContainers });
      }
      const droppableContainers = args.droppableContainers.filter(
        (c) =>
          (c.data.current as { type?: string } | undefined)?.type === "week" &&
          !weekIsLocked(draft, lockedSlotUids, String(c.id)),
      );
      return closestCenter({ ...args, droppableContainers });
    },
    [draft, lockedSlotUids],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as
        | WeekDragData
        | SessionDragData
        | LibrarySessionDragData
        | LibraryExerciseDragData
        | undefined;
      if (!data) return;
      if (data.type === "library-session") {
        setActiveDrag({ type: "library-session", session: data.session });
        return;
      }
      if (data.type === "library-exercise") {
        setActiveDrag({ type: "library-exercise", exercise: data.exercise });
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
        | LibraryExerciseDragData
        | undefined;
      const overData = over.data.current as
        | { type?: string; slotUid?: string }
        | undefined;
      if (!activeData) return;

      if (activeData.type === "week") {
        if (
          overData?.type === "week" &&
          active.id !== over.id &&
          // Belt: collision already excludes locked weeks; a locked endpoint
          // slipping through must still never re-date history.
          !weekIsLocked(draft, lockedSlotUids, String(active.id)) &&
          !weekIsLocked(draft, lockedSlotUids, String(over.id))
        ) {
          reorderWeek(String(active.id), String(over.id));
        }
        return;
      }
      if (overData?.type !== "day-slot") return;
      // Belt on both ends: a locked target never accepts, and a session card
      // in a locked slot never leaves (its draggable is disabled anyway).
      if (lockedSlotUids?.has(String(over.id))) return;
      if (activeData.type === "library-session") {
        placeLibrarySession(activeData.session, String(over.id));
        return;
      }
      if (activeData.type === "library-exercise") {
        placeLibraryExercise(activeData.exercise, String(over.id));
        return;
      }
      if (lockedSlotUids?.has(activeData.fromSlotUid)) return;
      moveSession(activeData.sessionUid, String(over.id));
    },
    [draft, lockedSlotUids, reorderWeek, moveSession, placeLibrarySession, placeLibraryExercise],
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
