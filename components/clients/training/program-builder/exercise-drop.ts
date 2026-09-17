import type { Collision, CollisionDetection } from "@dnd-kit/core";
import {
  moveExercise,
  moveGroup,
  type ExerciseDestination,
} from "./program-builder-groups";
import type { SessionDraft } from "./program-builder-types";

// Dragging in the session editor's exercise list. Nothing moves while a card is
// dragged — the list keeps its layout and a line shows where the drop lands —
// so the rectangles every decision is made against stay still, and the landing
// place is always one the coach can see: inside a linked group's rail the
// exercise joins that group, anywhere else it stands alone. Pure: the list
// wires these into dnd-kit, and the tests drive them with plain rectangles.

export type ExerciseDragData =
  | { type: "exercise"; exerciseUid: string }
  | { type: "group"; groupUid: string };

export type ExerciseDropData =
  // One of the session's groups: a standalone exercise's card, or a linked
  // group's whole block.
  | { type: "item"; index: number; linked: boolean }
  // A linked group's rail: the column its exercise cards sit in.
  | { type: "rail"; groupUid: string }
  // An exercise card in a linked group's rail.
  | { type: "member"; groupUid: string; index: number };

export const itemDropId = (groupUid: string) => `item:${groupUid}`;
export const railDropId = (groupUid: string) => `rail:${groupUid}`;
export const memberDropId = (exerciseUid: string) => `member:${exerciseUid}`;
export const exerciseDragId = (exerciseUid: string) => `exercise:${exerciseUid}`;
export const groupDragId = (groupUid: string) => `group:${groupUid}`;

type Rect = { top: number; bottom: number; left: number; right: number; height: number };
type Point = { x: number; y: number };
type Side = "before" | "after";

const within = (rect: Rect, p: Point) =>
  p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;

const sideOf = (rect: Rect, p: Point): Side => (p.y < rect.top + rect.height / 2 ? "before" : "after");

const distanceY = (rect: Rect, p: Point) =>
  p.y < rect.top ? rect.top - p.y : p.y > rect.bottom ? p.y - rect.bottom : 0;

/** The landing place a drop target and a side of it stand for. */
export function destinationFor(data: ExerciseDropData, side: Side): ExerciseDestination | null {
  const after = side === "after" ? 1 : 0;
  switch (data.type) {
    case "item":
      return { kind: "session", index: data.index + after };
    case "member":
      return { kind: "group", groupUid: data.groupUid, index: data.index + after };
    case "rail":
      return null;
  }
}

type Entry = { collision: Collision; rect: Rect; data: ExerciseDropData };

/**
 * Where the pointer would drop: an exercise over an exercise card in a rail
 * lands before or after it inside that group, and anywhere else in a rail next
 * to the nearest card there; over a linked group's heading it lands before the
 * group; over a standalone card, before or after it; between cards, beside the
 * nearest one. A dragged group only ever lands among the session's groups. The
 * one collision carries its landing place as `destination`.
 */
export const exerciseDropCollision: CollisionDetection = ({
  active,
  droppableContainers,
  droppableRects,
  pointerCoordinates,
}) => {
  const drag = active.data.current as ExerciseDragData | undefined;
  if (!pointerCoordinates || !drag) return [];
  const pointer = pointerCoordinates;
  const entries: Entry[] = droppableContainers.flatMap((container) => {
    const rect = droppableRects.get(container.id);
    const data = container.data.current as ExerciseDropData | undefined;
    return rect && data
      ? [{ collision: { id: container.id, data: { droppableContainer: container, value: 0 } }, rect, data }]
      : [];
  });
  const land = (entry: Entry, side: Side): Collision[] => [
    {
      ...entry.collision,
      data: { ...entry.collision.data, destination: destinationFor(entry.data, side) },
    },
  ];
  const nearest = (candidates: Entry[]) =>
    candidates.reduce<Entry | null>(
      (best, entry) =>
        best == null || distanceY(entry.rect, pointer) < distanceY(best.rect, pointer) ? entry : best,
      null,
    );

  if (drag.type === "exercise") {
    const member = entries.find((e) => e.data.type === "member" && within(e.rect, pointer));
    if (member) return land(member, sideOf(member.rect, pointer));
    const rail = entries.find((e) => e.data.type === "rail" && within(e.rect, pointer));
    if (rail && rail.data.type === "rail") {
      const groupUid = rail.data.groupUid;
      const closest = nearest(
        entries.filter((e) => e.data.type === "member" && e.data.groupUid === groupUid),
      );
      if (closest) return land(closest, sideOf(closest.rect, pointer));
    }
  }

  const items = entries.filter((e) => e.data.type === "item");
  const item = items.find((e) => within(e.rect, pointer));
  if (item) {
    // Over a linked group's block but outside its rail is over its heading.
    const heading = drag.type === "exercise" && item.data.type === "item" && item.data.linked;
    return land(item, heading ? "before" : sideOf(item.rect, pointer));
  }
  const closest = nearest(items);
  return closest ? land(closest, sideOf(closest.rect, pointer)) : [];
};

/** The landing place a drag event's collisions carry, or null. */
export function destinationOf(collisions: Collision[] | null): ExerciseDestination | null {
  const destination = (collisions?.[0]?.data as { destination?: ExerciseDestination } | undefined)
    ?.destination;
  return destination ?? null;
}

/**
 * Whether dropping there does anything: moves something, or is refused with a
 * reason the drop will show. A line is drawn only for such a drop, so dragging
 * a card over its own place draws none; a dragged group never lands inside
 * another group.
 */
export function dropChangesSession(
  session: SessionDraft,
  drag: ExerciseDragData,
  destination: ExerciseDestination,
): boolean {
  if (drag.type === "group") {
    if (destination.kind !== "session") return false;
    const result = moveGroup(session, drag.groupUid, destination.index);
    return result.ok && result.session !== session;
  }
  const result = moveExercise(session, drag.exerciseUid, destination, "drop-preview");
  return !result.ok || result.session !== session;
}

export const sameDestination = (
  a: ExerciseDestination | null,
  b: ExerciseDestination | null,
): boolean =>
  a === b ||
  (a != null &&
    b != null &&
    a.kind === b.kind &&
    a.index === b.index &&
    (a.kind !== "group" || (b.kind === "group" && a.groupUid === b.groupUid)));
