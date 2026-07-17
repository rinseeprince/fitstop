import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { SavedSession, Exercise } from "@/types/training";
import { slotAcceptsDrag, useProgramDnd } from "./use-program-dnd";

// -- slotAcceptsDrag: the pure collision matrix ------------------------------

describe("slotAcceptsDrag", () => {
  const occupied = { type: "day-slot", occupied: true };
  const rest = { type: "day-slot", occupied: false };

  it("a session hits any day-slot (rest or occupied)", () => {
    expect(slotAcceptsDrag("session", rest)).toBe(true);
    expect(slotAcceptsDrag("session", occupied)).toBe(true);
  });

  it("a library-session hits ONLY rest slots (one session per cell)", () => {
    expect(slotAcceptsDrag("library-session", rest)).toBe(true);
    expect(slotAcceptsDrag("library-session", occupied)).toBe(false);
  });

  it("a library-exercise hits ONLY occupied slots (it appends to a session)", () => {
    expect(slotAcceptsDrag("library-exercise", occupied)).toBe(true);
    expect(slotAcceptsDrag("library-exercise", rest)).toBe(false);
  });

  it("never collides with non-day-slot droppables", () => {
    expect(slotAcceptsDrag("session", { type: "week" })).toBe(false);
    expect(slotAcceptsDrag("library-exercise", { type: "week" })).toBe(false);
    expect(slotAcceptsDrag("session", {})).toBe(false);
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
  data: { current: { type: "day-slot", slotUid, occupied: true } },
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
        { id: "sess-1", data: { current: { type: "session", sessionUid: "sess-1", fromSlotUid: "slot-0" } } },
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
