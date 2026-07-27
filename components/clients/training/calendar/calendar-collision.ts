import {
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";

/**
 * Where a calendar drop lands.
 *
 * `closestCenter` — the default this replaced — is a RANKING, not a hit test: it
 * returns every candidate droppable sorted by centre distance, so a release that
 * hits nothing still resolves to the nearest cell. Measured on the rendered grid
 * (151x96 cells, 8px gutters): a drag released dead-centre over a past day moved
 * the session to a different day entirely, one column across and one row down.
 * Silent, and a real write.
 *
 * Three layers, in this order:
 *
 * 1. `pointerWithin` — the cursor is inside a cell. This is the honest answer
 *    whenever it exists, and it is what makes a drop land where it was aimed.
 * 2. `rectIntersection` — the cursor is in one of the 8px gutters, which is
 *    ordinary imprecision rather than intent. Falls back to what the dragged
 *    CARD overlaps, so a release a couple of pixels off a cell edge still lands
 *    on the cell it visually covers instead of doing nothing. Two-layer
 *    (pointer → nothing) would have traded a wrong-day bug for a dead zone, and
 *    "nothing happened" is the one users retry and then report as broken.
 * 3. `closestCenter` — keyboard dragging only, where there is no pointer at all
 *    and ranking is the only thing that can work.
 *
 * Past cells stay REGISTERED as droppables (see calendar-day-cell). Disabling
 * them is what produced the retarget: an excluded cell cannot win, so the drop
 * fell through to a neighbour. Registered, the drop resolves to the day the
 * coach aimed at and `handleDragEnd` refuses it with a reason.
 */
export const calendarCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};
