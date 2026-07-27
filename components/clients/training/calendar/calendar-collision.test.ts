import { describe, it, expect } from "vitest";
import type { ClientRect } from "@dnd-kit/core";
import { calendarCollisionDetection } from "./calendar-collision";

// Geometry measured off the rendered calendar (CDP, 2026-07-27): 151x96 cells,
// 8px gutters both axes. The gutters are the whole reason this file exists — at
// 8px a pointer-only resolver has a dead zone a coach hits by ordinary aiming.
const CELL_W = 151;
const CELL_H = 96;
const GUTTER = 8;
const ORIGIN_X = 334;
const ORIGIN_Y = 318;

function rect(col: number, row: number): ClientRect {
  const left = ORIGIN_X + col * (CELL_W + GUTTER);
  const top = ORIGIN_Y + row * (CELL_H + GUTTER);
  return {
    top, left, width: CELL_W, height: CELL_H,
    right: left + CELL_W, bottom: top + CELL_H,
  } as ClientRect;
}

const centre = (col: number, row: number) => {
  const r = rect(col, row);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** A 7x2 grid: row 0 = the past week, row 1 = the current week. */
const CELLS = Array.from({ length: 14 }, (_, i) => ({
  id: `d${i}`,
  col: i % 7,
  row: Math.floor(i / 7),
}));

function args(pointer: { x: number; y: number } | null, cardAt?: { x: number; y: number }) {
  const droppableRects = new Map(CELLS.map((c) => [c.id, rect(c.col, c.row)]));
  const droppableContainers = CELLS.map((c) => ({
    id: c.id,
    rect: { current: rect(c.col, c.row) },
    disabled: false,
  }));
  // The dragged card is cell-sized, centred on `cardAt` (defaults to the pointer).
  const c = cardAt ?? pointer ?? { x: 0, y: 0 };
  const collisionRect = {
    top: c.y - CELL_H / 2, left: c.x - CELL_W / 2,
    width: CELL_W, height: CELL_H,
    right: c.x + CELL_W / 2, bottom: c.y + CELL_H / 2,
  } as ClientRect;
  return {
    active: { id: "drag", rect: { current: { initial: null, translated: collisionRect } }, data: { current: undefined } },
    collisionRect,
    droppableRects,
    droppableContainers,
    pointerCoordinates: pointer,
  } as unknown as Parameters<typeof calendarCollisionDetection>[0];
}

describe("calendarCollisionDetection", () => {
  it("lands on the cell under the pointer", () => {
    const hits = calendarCollisionDetection(args(centre(2, 0)));
    expect(hits[0]?.id).toBe("d2");
  });

  // The regression this file exists for. A past cell stays registered, so the
  // drop resolves TO it and the drag handler refuses it by date. Under
  // closestCenter with past cells disabled, this same release resolved to a
  // different day and moved the session there — observed on the real calendar.
  it("does not retarget a release aimed at another cell", () => {
    for (const [col, row] of [[0, 0], [3, 0], [6, 0], [4, 1]] as const) {
      const hits = calendarCollisionDetection(args(centre(col, row)));
      expect(hits[0]?.id).toBe(`d${row * 7 + col}`);
    }
  });

  it("still lands when the pointer falls in an 8px gutter", () => {
    // Two pixels into the gap between column 2 and column 3, card mostly over d2.
    const r = rect(2, 0);
    const gutterPoint = { x: r.right + 2, y: r.top + r.height / 2 };
    const hits = calendarCollisionDetection(args(gutterPoint, centre(2, 0)));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe("d2");
  });

  it("still lands when the pointer falls in the row gutter", () => {
    const r = rect(2, 0);
    const gutterPoint = { x: r.left + r.width / 2, y: r.bottom + 3 };
    const hits = calendarCollisionDetection(args(gutterPoint, centre(2, 0)));
    expect(hits[0]?.id).toBe("d2");
  });

  it("ranks by centre distance for keyboard drags, which have no pointer", () => {
    const hits = calendarCollisionDetection(args(null, centre(5, 1)));
    expect(hits[0]?.id).toBe("d12");
  });
});
