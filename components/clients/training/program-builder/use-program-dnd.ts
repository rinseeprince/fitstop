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
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Exercise, SavedSession } from "@/types/training";
import { MAX_SESSIONS_PER_DAY } from "@/lib/training-constants";
import type { SessionDraft, WeekDraft } from "./program-builder-types";
import { findSession } from "./use-program-builder-state";
import type { ProgramDraft } from "./program-builder-types";

// One DndContext handles all four drag kinds, discriminated by data.type. A
// day a drag can't land on is filtered out of collision (slotAcceptsDrag), so
// it never highlights and a drop there is inert:
// - "week": sortable week rows (vertical reorder)
// - "session": one session card of a day cell, dropped on a "day-slot"
//   droppable: onto another day it joins that day, last; over its own day it
//   changes its place in the day, where the line between the day's cards says
//   (the cards are "day-session" droppables for that alone)
// - "library-session": a library-panel session card, dropped on a day-slot
//   with room — it joins the day, last
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
  /** The session's place in its day, 0 first. */
  index: number;
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
/** A session card in a day cell: where a session dragged within its own day can land. */
export type DaySessionDropData = { type: "day-session"; slotUid: string; index: number };

/**
 * A session drag, from its start to its drop: the day the session comes from,
 * and the place in that day, counted as it stands, before which it would land
 * (the day's session count = after the last) — null while the pointer is off
 * the day or landing there would leave the day's order as it is. Set as the
 * drag starts, so no frame shows the day as one the session could join — not
 * even those before the pointer first moves.
 */
export type DayReorder = { slotUid: string; place: number | null };

export const daySessionDropId = (sessionUid: string) => `day-session:${sessionUid}`;

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
// unit-testable without dnd-kit geometry. A session hits any day with room, and
// always its own day (to change its place there); a library-session any day
// with room; a library-exercise only a slot holding exactly one session. A
// locked slot (placed-plan history) accepts nothing.
export function slotAcceptsDrag(
  active: { type?: string; fromSlotUid?: string },
  slot: { type?: string; sessionCount?: number; slotUid?: string },
  lockedSlotUids?: ReadonlySet<string>,
): boolean {
  if (slot.type !== "day-slot") return false;
  if (slot.slotUid && lockedSlotUids?.has(slot.slotUid)) return false;
  const sessionCount = slot.sessionCount ?? 0;
  const hasRoom = sessionCount < MAX_SESSIONS_PER_DAY;
  switch (active.type) {
    case "session":
      return hasRoom || (slot.slotUid != null && slot.slotUid === active.fromSlotUid);
    case "library-session":
      return hasRoom;
    case "library-exercise":
      return sessionCount === 1;
    default:
      return false;
  }
}

/**
 * Where a session dragged within its own day lands: before the first card whose
 * middle is below `y`, else after the last — a place counted in the day as it
 * stands. Null when that is the session's own place (before or right after
 * itself), since landing there changes nothing.
 */
export function reorderPlace(
  cards: ReadonlyArray<{ index: number; rect: Pick<ClientRect, "top" | "height"> }>,
  y: number,
  fromIndex: number,
): number | null {
  const sorted = [...cards].sort((a, b) => a.index - b.index);
  const before = sorted.find((card) => y < card.rect.top + card.rect.height / 2);
  const place = before ? before.index : sorted.length;
  return place === fromIndex || place === fromIndex + 1 ? null : place;
}

/** The index a session takes when it lands before `place` in its own day. */
export const reorderTarget = (place: number, fromIndex: number) =>
  place > fromIndex ? place - 1 : place;

/** The place a session drag's collisions give it in its own day; null off the day. */
function ownDayPlace(
  active: SessionDragData | undefined,
  collisions: Collision[] | null,
): number | null {
  const hit = collisions?.[0];
  if (active?.type !== "session" || !hit || hit.id !== active.fromSlotUid) return null;
  return (hit.data as { place?: number | null } | undefined)?.place ?? null;
}

type UseProgramDndParams = {
  draft: ProgramDraft | null;
  reorderWeek: (activeUid: string, overUid: string) => void;
  moveSession: (sessionUid: string, targetSlotUid: string) => void;
  reorderSession: (sessionUid: string, toIndex: number) => void;
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
  reorderSession,
  placeLibrarySession,
  placeLibraryExercise,
  lockedSlotUids,
}: UseProgramDndParams) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  // A session drag's own day, and where the session would land in it.
  const [dayReorder, setDayReorder] = useState<DayReorder | null>(null);

  const sensors = useSensors(
    // 4px activation distance so a plain click on a grip doesn't register as a
    // drag (same constraint the draft editor uses).
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Type-aware collision: a dragged session or library card only collides
  // with the day-slot droppables slotAcceptsDrag lets it land on
  // (pointerWithin feels right for cell targets, rectIntersection as fallback
  // for keyboard/edge cases); a dragged week only collides with week rows. A
  // session over its own day carries the place it would land at, read from
  // that day's cards.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const active =
        (args.active.data.current as
          | { type?: string; fromSlotUid?: string; index?: number }
          | undefined) ?? {};
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
        const hits = within.length > 0 ? within : rectIntersection({ ...args, droppableContainers });
        const hit = hits[0];
        if (active.type !== "session" || !hit || hit.id !== active.fromSlotUid) return hits;

        const y =
          args.pointerCoordinates?.y ?? args.collisionRect.top + args.collisionRect.height / 2;
        const cards = args.droppableContainers.flatMap((c) => {
          const data = c.data.current as DaySessionDropData | undefined;
          const rect = args.droppableRects.get(c.id);
          return data?.type === "day-session" && data.slotUid === active.fromSlotUid && rect
            ? [{ index: data.index, rect }]
            : [];
        });
        const place = reorderPlace(cards, y, active.index ?? 0);
        return [{ ...hit, data: { ...hit.data, place } }];
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
      if (session) {
        setActiveDrag({ type: "session", session });
        setDayReorder({ slotUid: data.fromSlotUid, place: null });
      }
    },
    [draft],
  );

  // A move changes only the place, and only a session drag has one; every other
  // move keeps the state as it is, so the grid re-renders only when the line moves.
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const place = ownDayPlace(
      event.active.data.current as SessionDragData | undefined,
      event.collisions,
    );
    setDayReorder((current) =>
      current == null || current.place === place ? current : { ...current, place },
    );
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
    setDayReorder(null);
  }, []);

  // The drop and the end of the drag are ONE render: the draft edit below and
  // the cleared drag state batch together, so the card is in its new place the
  // frame the line and the copy go.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      setDayReorder(null);
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
      if (String(over.id) === activeData.fromSlotUid) {
        const place = ownDayPlace(activeData, event.collisions);
        if (place != null) {
          reorderSession(activeData.sessionUid, reorderTarget(place, activeData.index));
        }
        return;
      }
      moveSession(activeData.sessionUid, String(over.id));
    },
    [draft, lockedSlotUids, reorderWeek, moveSession, reorderSession, placeLibrarySession, placeLibraryExercise],
  );

  return {
    sensors,
    collisionDetection,
    activeDrag,
    dayReorder,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}
