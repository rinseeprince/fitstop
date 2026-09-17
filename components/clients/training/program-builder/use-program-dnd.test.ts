import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { SavedSession, Exercise } from "@/types/training";
import { slotAcceptsDrag, useProgramDnd } from "./use-program-dnd";

// -- slotAcceptsDrag: the pure collision matrix ------------------------------

describe("slotAcceptsDrag", () => {
  const rest = { type: "day-slot", sessionCount: 0 };
  const one = { type: "day-slot", sessionCount: 1 };
  const two = { type: "day-slot", sessionCount: 2 };
  const alone = { type: "session", aloneOnDay: true };
  const shared = { type: "session", aloneOnDay: false };
  const librarySession = { type: "library-session" };
  const libraryExercise = { type: "library-exercise" };

  it("a session alone on its day hits a rest day, or a day holding one (the swap)", () => {
    expect(slotAcceptsDrag(alone, rest)).toBe(true);
    expect(slotAcceptsDrag(alone, one)).toBe(true);
    expect(slotAcceptsDrag(alone, two)).toBe(false);
  });

  it("a session sharing its day hits only a rest day", () => {
    expect(slotAcceptsDrag(shared, rest)).toBe(true);
    expect(slotAcceptsDrag(shared, one)).toBe(false);
    expect(slotAcceptsDrag(shared, two)).toBe(false);
  });

  it("a library-session hits ONLY rest days", () => {
    expect(slotAcceptsDrag(librarySession, rest)).toBe(true);
    expect(slotAcceptsDrag(librarySession, one)).toBe(false);
    expect(slotAcceptsDrag(librarySession, two)).toBe(false);
  });

  it("a library-exercise hits ONLY a day holding exactly one session (it appends to it)", () => {
    expect(slotAcceptsDrag(libraryExercise, one)).toBe(true);
    expect(slotAcceptsDrag(libraryExercise, rest)).toBe(false);
    expect(slotAcceptsDrag(libraryExercise, two)).toBe(false);
  });

  it("never collides with non-day-slot droppables", () => {
    expect(slotAcceptsDrag(alone, { type: "week" })).toBe(false);
    expect(slotAcceptsDrag(libraryExercise, { type: "week" })).toBe(false);
    expect(slotAcceptsDrag(alone, {})).toBe(false);
  });
});

// -- handleDragEnd routing ----------------------------------------------------

const session = { id: "s1", name: "Push", exercises: [] } as unknown as SavedSession;
const exercise = { id: "e1", name: "Bench", coachId: null } as unknown as Exercise;

function setup() {
  const reorderWeek = vi.fn();
  const moveSession = vi.fn();
  const placeLibrarySession = vi.fn();
  const placeLibraryExercise = vi.fn();
  const { result } = renderHook(() =>
    useProgramDnd({
      draft: null,
      reorderWeek,
      moveSession,
      placeLibrarySession,
      placeLibraryExercise,
    }),
  );
  return { result, reorderWeek, moveSession, placeLibrarySession, placeLibraryExercise };
}

const daySlotOver = (slotUid: string) => ({
  id: slotUid,
  data: { current: { type: "day-slot", slotUid, sessionCount: 1 } },
});

const end = (active: unknown, over: unknown) =>
  ({ active, over } as unknown as DragEndEvent);

describe("useProgramDnd handleDragEnd", () => {
  it("routes a library-exercise over a day-slot to placeLibraryExercise", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(
        { id: "libex-e1", data: { current: { type: "library-exercise", exercise } } },
        daySlotOver("slot-3"),
      ),
    );
    expect(s.placeLibraryExercise).toHaveBeenCalledWith(exercise, "slot-3");
    expect(s.placeLibrarySession).not.toHaveBeenCalled();
    expect(s.moveSession).not.toHaveBeenCalled();
  });

  it("routes a library-session over a day-slot to placeLibrarySession", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(
        { id: "lib-s1", data: { current: { type: "library-session", session } } },
        daySlotOver("slot-2"),
      ),
    );
    expect(s.placeLibrarySession).toHaveBeenCalledWith(session, "slot-2");
    expect(s.placeLibraryExercise).not.toHaveBeenCalled();
  });

  it("routes a session over a day-slot to moveSession", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(
        {
          id: "sess-1",
          data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid: "slot-0", aloneOnDay: true } },
        },
        daySlotOver("slot-5"),
      ),
    );
    expect(s.moveSession).toHaveBeenCalledWith("sess-1", "slot-5");
    expect(s.placeLibraryExercise).not.toHaveBeenCalled();
  });

  it("routes a week over a week to reorderWeek", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(
        { id: "wk-a", data: { current: { type: "week", weekUid: "wk-a" } } },
        { id: "wk-b", data: { current: { type: "week", weekUid: "wk-b" } } },
      ),
    );
    expect(s.reorderWeek).toHaveBeenCalledWith("wk-a", "wk-b");
  });

  it("ignores a library-exercise dropped somewhere other than a day-slot", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(
        { id: "libex-e1", data: { current: { type: "library-exercise", exercise } } },
        { id: "wk-b", data: { current: { type: "week", weekUid: "wk-b" } } },
      ),
    );
    expect(s.placeLibraryExercise).not.toHaveBeenCalled();
  });

  it("no-ops when there is no drop target", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(
        { id: "libex-e1", data: { current: { type: "library-exercise", exercise } } },
        null,
      ),
    );
    expect(s.placeLibraryExercise).not.toHaveBeenCalled();
  });
});

// -- collisionDetection: the drag's own data reaches the matrix ----------------

describe("useProgramDnd collisionDetection", () => {
  const rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
  const day = (id: string, sessionCount: number) => ({
    id,
    data: { current: { type: "day-slot", slotUid: id, sessionCount } },
  });

  // Every day sits under the pointer; what collides is what the drag may land on.
  function collide(active: Record<string, unknown>) {
    const { result } = setup();
    const days = [day("slot-rest", 0), day("slot-one", 1), day("slot-two", 2)];
    const hits = result.current.collisionDetection({
      active: { id: "drag", data: { current: active } },
      collisionRect: rect,
      droppableRects: new Map(days.map((d) => [d.id, rect])),
      droppableContainers: days,
      pointerCoordinates: { x: 50, y: 50 },
    } as never);
    return hits.map((hit) => hit.id).sort();
  }

  it("a session sharing its day reaches only a rest day; alone, a day holding one too; never a day holding two", () => {
    expect(collide({ type: "session", sessionUid: "s", fromSlotUid: "f", aloneOnDay: false })).toEqual([
      "slot-rest",
    ]);
    expect(collide({ type: "session", sessionUid: "s", fromSlotUid: "f", aloneOnDay: true })).toEqual([
      "slot-one",
      "slot-rest",
    ]);
    expect(collide({ type: "library-session", session })).toEqual(["slot-rest"]);
    expect(collide({ type: "library-exercise", exercise })).toEqual(["slot-one"]);
  });
});

// -- placed-plan locking ------------------------------------------------------

describe("locked slots (placed-plan)", () => {
  const locked = new Set(["slot-locked"]);

  it("slotAcceptsDrag refuses every drag type on a locked slot", () => {
    const alone = { type: "session", aloneOnDay: true };
    const lockedRest = { type: "day-slot", sessionCount: 0, slotUid: "slot-locked" };
    const lockedOne = { type: "day-slot", sessionCount: 1, slotUid: "slot-locked" };
    const openRest = { type: "day-slot", sessionCount: 0, slotUid: "slot-open" };
    expect(slotAcceptsDrag(alone, lockedRest, locked)).toBe(false);
    expect(slotAcceptsDrag(alone, lockedOne, locked)).toBe(false);
    expect(slotAcceptsDrag({ type: "library-session" }, lockedRest, locked)).toBe(false);
    expect(slotAcceptsDrag({ type: "library-exercise" }, lockedOne, locked)).toBe(false);
    expect(slotAcceptsDrag(alone, openRest, locked)).toBe(true);
    // Without a locked set the matrix is unchanged.
    expect(slotAcceptsDrag(alone, lockedRest)).toBe(true);
  });

  function setupLocked() {
    const reorderWeek = vi.fn();
    const moveSession = vi.fn();
    const placeLibrarySession = vi.fn();
    const placeLibraryExercise = vi.fn();
    const draft = {
      id: "p",
      name: "P",
      description: null,
      status: "saved",
      splitType: null,
      programDurationWeeks: null,
      defaultSurplusPercentage: null,
      weeks: [
        {
          uid: "wk-locked",
          weekIndex: 0,
          days: [{ uid: "slot-locked", orderIndex: 0, isRest: true, sessions: [] }],
        },
        {
          uid: "wk-open",
          weekIndex: 1,
          days: [{ uid: "slot-open", orderIndex: 0, isRest: true, sessions: [] }],
        },
      ],
    } as never;
    const { result } = renderHook(() =>
      useProgramDnd({
        draft,
        reorderWeek,
        moveSession,
        placeLibrarySession,
        placeLibraryExercise,
        lockedSlotUids: locked,
      }),
    );
    return { result, reorderWeek, moveSession, placeLibrarySession, placeLibraryExercise };
  }

  it("handleDragEnd belt: a drop ONTO a locked slot is inert for every type", () => {
    const s = setupLocked();
    const overLocked = {
      id: "slot-locked",
      data: { current: { type: "day-slot", slotUid: "slot-locked", sessionCount: 0 } },
    };
    s.result.current.handleDragEnd(
      end({ id: "lib-s1", data: { current: { type: "library-session", session } } }, overLocked),
    );
    s.result.current.handleDragEnd(
      end({ id: "libex-e1", data: { current: { type: "library-exercise", exercise } } }, overLocked),
    );
    s.result.current.handleDragEnd(
      end(
        {
          id: "sess-1",
          data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid: "slot-open", aloneOnDay: true } },
        },
        overLocked,
      ),
    );
    expect(s.placeLibrarySession).not.toHaveBeenCalled();
    expect(s.placeLibraryExercise).not.toHaveBeenCalled();
    expect(s.moveSession).not.toHaveBeenCalled();
  });

  it("handleDragEnd belt: a session dragged FROM a locked slot never moves", () => {
    const s = setupLocked();
    s.result.current.handleDragEnd(
      end(
        {
          id: "sess-1",
          data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid: "slot-locked", aloneOnDay: true } },
        },
        daySlotOver("slot-open"),
      ),
    );
    expect(s.moveSession).not.toHaveBeenCalled();
  });

  it("handleDragEnd belt: week reorder refuses a locked endpoint but allows open weeks", () => {
    const s = setupLocked();
    const weekEvt = (a: string, b: string) =>
      end(
        { id: a, data: { current: { type: "week", weekUid: a } } },
        { id: b, data: { current: { type: "week", weekUid: b } } },
      );
    s.result.current.handleDragEnd(weekEvt("wk-locked", "wk-open"));
    s.result.current.handleDragEnd(weekEvt("wk-open", "wk-locked"));
    expect(s.reorderWeek).not.toHaveBeenCalled();
  });
});
