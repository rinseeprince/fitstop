import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import type { SavedSession, Exercise } from "@/types/training";
import { MAX_SESSIONS_PER_DAY } from "@/lib/training-constants";
import {
  reorderPlace,
  reorderTarget,
  slotAcceptsDrag,
  useProgramDnd,
} from "./use-program-dnd";

// -- slotAcceptsDrag: the pure collision matrix ------------------------------

describe("slotAcceptsDrag", () => {
  const rest = { type: "day-slot", sessionCount: 0, slotUid: "slot-rest" };
  const one = { type: "day-slot", sessionCount: 1, slotUid: "slot-one" };
  const two = { type: "day-slot", sessionCount: 2, slotUid: "slot-two" };
  const full = { type: "day-slot", sessionCount: MAX_SESSIONS_PER_DAY, slotUid: "slot-full" };
  const session = { type: "session", fromSlotUid: "slot-elsewhere" };
  const librarySession = { type: "library-session" };
  const libraryExercise = { type: "library-exercise" };

  it("a session hits any day with room — a rest day, a day holding one, a day holding two", () => {
    expect(slotAcceptsDrag(session, rest)).toBe(true);
    expect(slotAcceptsDrag(session, one)).toBe(true);
    expect(slotAcceptsDrag(session, two)).toBe(true);
  });

  it("a session never hits another full day, but always its own day (to change its place there)", () => {
    expect(slotAcceptsDrag(session, full)).toBe(false);
    expect(slotAcceptsDrag({ type: "session", fromSlotUid: "slot-full" }, full)).toBe(true);
  });

  it("a library-session hits any day with room, never a full one", () => {
    expect(slotAcceptsDrag(librarySession, rest)).toBe(true);
    expect(slotAcceptsDrag(librarySession, one)).toBe(true);
    expect(slotAcceptsDrag(librarySession, two)).toBe(true);
    expect(slotAcceptsDrag(librarySession, full)).toBe(false);
  });

  it("a library-exercise hits ONLY a day holding exactly one session (it appends to it)", () => {
    expect(slotAcceptsDrag(libraryExercise, one)).toBe(true);
    expect(slotAcceptsDrag(libraryExercise, rest)).toBe(false);
    expect(slotAcceptsDrag(libraryExercise, two)).toBe(false);
  });

  it("never collides with non-day-slot droppables — a session card is not a drop target", () => {
    expect(slotAcceptsDrag(session, { type: "week" })).toBe(false);
    expect(slotAcceptsDrag(libraryExercise, { type: "week" })).toBe(false);
    expect(slotAcceptsDrag(session, { type: "day-session" })).toBe(false);
    expect(slotAcceptsDrag(session, {})).toBe(false);
  });
});

// -- reorderPlace: where a session dragged within its own day lands ------------

describe("reorderPlace / reorderTarget", () => {
  // Three stacked cards, 100px tall with 8px gaps: middles at 50, 158, 266.
  const cards = [0, 1, 2].map((index) => ({ index, rect: { top: index * 108, height: 100 } }));

  it("lands before the first card whose middle is below the pointer, else after the last", () => {
    expect(reorderPlace(cards, 10, 2)).toBe(0);
    expect(reorderPlace(cards, 120, 2)).toBe(1);
    expect(reorderPlace(cards, 300, 0)).toBe(3);
  });

  it("is null for the session's own place — before itself or right after it", () => {
    // The middle card: above its middle is before it, below is right after it.
    expect(reorderPlace(cards, 120, 1)).toBeNull();
    expect(reorderPlace(cards, 200, 1)).toBeNull();
    // The last card over the space after it.
    expect(reorderPlace(cards, 300, 2)).toBeNull();
  });

  it("reads the cards by their place, whatever order they come in", () => {
    expect(reorderPlace([...cards].reverse(), 10, 2)).toBe(0);
  });

  it("turns a place counted in the day as it stands into the session's new index", () => {
    // Down past itself: the place counts the session, so its index is one less.
    expect(reorderTarget(3, 0)).toBe(2);
    expect(reorderTarget(2, 0)).toBe(1);
    // Up: the place is the index.
    expect(reorderTarget(0, 2)).toBe(0);
  });
});

// -- handleDragEnd routing ----------------------------------------------------

const session = { id: "s1", name: "Push", exercises: [] } as unknown as SavedSession;
const exercise = { id: "e1", name: "Bench", coachId: null } as unknown as Exercise;

function setup() {
  const reorderWeek = vi.fn();
  const moveSession = vi.fn();
  const reorderSession = vi.fn();
  const placeLibrarySession = vi.fn();
  const placeLibraryExercise = vi.fn();
  const { result } = renderHook(() =>
    useProgramDnd({
      draft: null,
      reorderWeek,
      moveSession,
      reorderSession,
      placeLibrarySession,
      placeLibraryExercise,
    }),
  );
  return { result, reorderWeek, moveSession, reorderSession, placeLibrarySession, placeLibraryExercise };
}

const daySlotOver = (slotUid: string) => ({
  id: slotUid,
  data: { current: { type: "day-slot", slotUid, sessionCount: 1 } },
});

const end = (active: unknown, over: unknown, collisions: unknown = null) =>
  ({ active, over, collisions } as unknown as DragEndEvent);

const sessionDrag = (fromSlotUid: string, index = 0) => ({
  id: "sess-1",
  data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid, index } },
});

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

  it("routes a session over ANOTHER day-slot to moveSession (it joins that day, last)", () => {
    const s = setup();
    s.result.current.handleDragEnd(end(sessionDrag("slot-0"), daySlotOver("slot-5")));
    expect(s.moveSession).toHaveBeenCalledWith("sess-1", "slot-5");
    expect(s.reorderSession).not.toHaveBeenCalled();
    expect(s.placeLibraryExercise).not.toHaveBeenCalled();
  });

  it("routes a session over its OWN day to reorderSession at the place the collision carries", () => {
    const s = setup();
    // The day's first session dropped after the third: place 3, index 2.
    s.result.current.handleDragEnd(
      end(sessionDrag("slot-0", 0), daySlotOver("slot-0"), [{ id: "slot-0", data: { place: 3 } }]),
    );
    expect(s.reorderSession).toHaveBeenCalledWith("sess-1", 2);
    // The third dropped before the first: place 0, index 0.
    s.result.current.handleDragEnd(
      end(sessionDrag("slot-0", 2), daySlotOver("slot-0"), [{ id: "slot-0", data: { place: 0 } }]),
    );
    expect(s.reorderSession).toHaveBeenLastCalledWith("sess-1", 0);
    expect(s.moveSession).not.toHaveBeenCalled();
  });

  it("a session dropped on its own place in its own day changes nothing", () => {
    const s = setup();
    s.result.current.handleDragEnd(
      end(sessionDrag("slot-0", 1), daySlotOver("slot-0"), [{ id: "slot-0", data: { place: null } }]),
    );
    s.result.current.handleDragEnd(end(sessionDrag("slot-0", 1), daySlotOver("slot-0"), null));
    expect(s.reorderSession).not.toHaveBeenCalled();
    expect(s.moveSession).not.toHaveBeenCalled();
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

  it("a session or a library session reaches every day with room; a library exercise a day holding one", () => {
    expect(collide({ type: "session", sessionUid: "s", fromSlotUid: "f", index: 0 })).toEqual([
      "slot-one",
      "slot-rest",
      "slot-two",
    ]);
    expect(collide({ type: "library-session", session })).toEqual(["slot-one", "slot-rest", "slot-two"]);
    expect(collide({ type: "library-exercise", exercise })).toEqual(["slot-one"]);
  });

  // A day holding three stacked cards, the dragged session its first.
  function collideOwnDay(pointerY: number | null, index = 0) {
    const { result } = setup();
    const dayRect = { top: 0, left: 0, right: 100, bottom: 316, width: 100, height: 316 };
    const cardRect = (i: number) => ({ top: i * 108, left: 0, right: 100, bottom: i * 108 + 100, width: 100, height: 100 });
    const containers = [
      { id: "slot-own", data: { current: { type: "day-slot", slotUid: "slot-own", sessionCount: 3 } } },
      ...[0, 1, 2].map((i) => ({
        id: `day-session:s${i}`,
        data: { current: { type: "day-session", slotUid: "slot-own", index: i } },
      })),
    ];
    const rects = new Map<string, typeof dayRect>([
      ["slot-own", dayRect],
      ...[0, 1, 2].map((i) => [`day-session:s${i}`, cardRect(i)] as [string, typeof dayRect]),
    ]);
    return result.current.collisionDetection({
      active: { id: `s${index}`, data: { current: { type: "session", sessionUid: `s${index}`, fromSlotUid: "slot-own", index } } },
      // The dragged card's own rect, for the keyboard path with no pointer.
      collisionRect: pointerY == null ? { ...cardRect(2), top: 250, bottom: 350 } : cardRect(index),
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: pointerY == null ? null : { x: 50, y: pointerY },
    } as never);
  }

  it("over its own day a session's collision is the day, carrying the place it would take", () => {
    const hits = collideOwnDay(300);
    expect(hits.map((hit) => hit.id)).toEqual(["slot-own"]);
    expect(hits[0].data?.place).toBe(3);
    // Over its own card: no change, so no place.
    expect(collideOwnDay(20)[0].data?.place).toBeNull();
  });

  it("with no pointer (the keyboard) the place is read from the dragged card's middle", () => {
    const hits = collideOwnDay(null);
    expect(hits[0].data?.place).toBe(3);
  });
});

// -- handleDragMove: the line over the dragged session's own day ---------------

describe("useProgramDnd handleDragMove", () => {
  const move = (active: unknown, collisions: unknown) =>
    ({ active, collisions } as unknown as DragMoveEvent);

  it("tracks the place over the session's own day, and clears it anywhere else", () => {
    const s = setup();
    act(() => {
      s.result.current.handleDragMove(
        move(sessionDrag("slot-0", 0), [{ id: "slot-0", data: { place: 2 } }]),
      );
    });
    expect(s.result.current.dayReorder).toEqual({ slotUid: "slot-0", place: 2 });

    // Hovering its own place: still its own day, but no line.
    act(() => {
      s.result.current.handleDragMove(
        move(sessionDrag("slot-0", 0), [{ id: "slot-0", data: { place: null } }]),
      );
    });
    expect(s.result.current.dayReorder).toEqual({ slotUid: "slot-0", place: null });

    // Another day: the join, which the day's border shows.
    act(() => {
      s.result.current.handleDragMove(move(sessionDrag("slot-0", 0), [{ id: "slot-4", data: {} }]));
    });
    expect(s.result.current.dayReorder).toBeNull();
  });

  it("keeps the same state object while the place doesn't change, so the grid doesn't re-render", () => {
    const s = setup();
    act(() => {
      s.result.current.handleDragMove(
        move(sessionDrag("slot-0", 0), [{ id: "slot-0", data: { place: 2 } }]),
      );
    });
    const first = s.result.current.dayReorder;
    act(() => {
      s.result.current.handleDragMove(
        move(sessionDrag("slot-0", 0), [{ id: "slot-0", data: { place: 2 } }]),
      );
    });
    expect(s.result.current.dayReorder).toBe(first);
  });

  it("a drop clears the line in the same update as the drag", () => {
    const s = setup();
    act(() => {
      s.result.current.handleDragMove(
        move(sessionDrag("slot-0", 0), [{ id: "slot-0", data: { place: 2 } }]),
      );
    });
    act(() => {
      s.result.current.handleDragEnd(
        end(sessionDrag("slot-0", 0), daySlotOver("slot-0"), [{ id: "slot-0", data: { place: 2 } }]),
      );
    });
    expect(s.result.current.dayReorder).toBeNull();
    expect(s.result.current.activeDrag).toBeNull();
    expect(s.reorderSession).toHaveBeenCalledWith("sess-1", 1);
  });
});

// -- placed-plan locking ------------------------------------------------------

describe("locked slots (placed-plan)", () => {
  const locked = new Set(["slot-locked"]);

  it("slotAcceptsDrag refuses every drag type on a locked slot", () => {
    const alone = { type: "session", fromSlotUid: "slot-open" };
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
    const reorderSession = vi.fn();
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
        reorderSession,
        placeLibrarySession,
        placeLibraryExercise,
        lockedSlotUids: locked,
      }),
    );
    return { result, reorderWeek, moveSession, reorderSession, placeLibrarySession, placeLibraryExercise };
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
          data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid: "slot-open", index: 0 } },
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
          data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid: "slot-locked", index: 0 } },
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
