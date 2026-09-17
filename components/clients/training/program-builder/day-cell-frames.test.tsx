import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { DndContext, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { DayCell } from "./day-cell";
import { useProgramBuilderState } from "./use-program-builder-state";
import { useProgramDnd, type SessionDragData } from "./use-program-dnd";
import { makeRestWeek, type ProgramDraft, type SessionDraft } from "./program-builder-types";

// The frame test for the day cell's drag interactions (CONVENTIONS §7 → "No
// frame disagrees"). A drop changes two things on screen: where the session
// sits (the draft) and whether a drag is showing (the drag state: the copy
// following the pointer — mounted by the builder exactly while `activeDrag` is
// set — and the line over the day). Each has one owner, and the drop must
// change both in ONE commit, so no frame shows the session in its new place
// with a line or a copy still up, or the line gone with the session not yet
// moved. The builder's state and dnd hooks are the real ones and the day cells
// render for real; only the pointer is simulated, through the hook's handlers.
//
// A third thing on screen is which day's cards carry the teal border that says
// "this drop joins the day". It follows dnd-kit's `over`, which DndContext sets
// in a commit of its own — as the drag starts, before any move reaches the
// hook — and clears with the drop. `over` below is that value, moved the way
// DndContext moves it, and read by every droppable as dnd-kit's own isOver.
const over = vi.hoisted(() => {
  let id: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => id,
    set(next: string | null) {
      id = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const react = await import("react");
  return {
    ...actual,
    useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => {
      const droppable = actual.useDroppable(args);
      const overId = react.useSyncExternalStore(over.subscribe, over.get);
      return { ...droppable, isOver: overId === args.id };
    },
  };
});

type Frame = {
  day1: string[];
  day4: string[];
  lines: number;
  // The days whose cards show the join border.
  lit: string[];
  dragging: boolean;
};

const JOIN_BORDER = "border-[#0d9488]";

const session = (uid: string, name: string): SessionDraft => ({
  uid,
  name,
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups: [],
});

// Day 1 holds a morning run then an evening lift; day 4 holds Upper.
function draft(): ProgramDraft {
  const week = makeRestWeek(0);
  week.days[0] = {
    ...week.days[0],
    uid: "slot-day1",
    isRest: false,
    sessions: [session("sess-am", "AM run"), session("sess-pm", "PM lift")],
  };
  week.days[3] = { ...week.days[3], uid: "slot-day4", isRest: false, sessions: [session("sess-upper", "Upper")] };
  return {
    id: "plan-1",
    name: "P",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: 1,
    defaultSurplusPercentage: null,
    weeks: [week],
  };
}

type Api = {
  state: ReturnType<typeof useProgramBuilderState>;
  dnd: ReturnType<typeof useProgramDnd>;
};

function Harness({ api, frames }: { api: { current: Api | null }; frames: Frame[] }) {
  const state = useProgramBuilderState();
  const dnd = useProgramDnd({
    draft: state.draft,
    reorderWeek: state.reorderWeek,
    moveSession: state.moveSession,
    reorderSession: state.reorderSession,
    placeLibrarySession: vi.fn(),
    placeLibraryExercise: vi.fn(),
  });
  api.current = { state, dnd };
  // dnd-kit's own commit when `over` changes lands here too, so it is a frame.
  useSyncExternalStore(over.subscribe, over.get);

  // After every commit, what the screen shows.
  useLayoutEffect(() => {
    const cards = (slot: string) => [
      ...document.querySelectorAll(`[data-testid="${slot}"] [aria-label^="Open session "]`),
    ];
    const names = (slot: string) =>
      cards(slot).map((node) => (node.getAttribute("aria-label") ?? "").replace("Open session ", ""));
    if (!state.draft) return;
    frames.push({
      day1: names("slot-day1"),
      day4: names("slot-day4"),
      lines: document.querySelectorAll('[data-testid="drop-line"]').length,
      lit: ["slot-day1", "slot-day4"].filter((slot) =>
        cards(slot).some((card) => card.classList.contains(JOIN_BORDER)),
      ),
      dragging: dnd.activeDrag != null,
    });
  });

  if (!state.draft) return null;
  const [day1, , , day4] = state.draft.weeks[0].days;
  return (
    <DndContext>
      {[day1, day4].map((slot) => (
        <div key={slot.uid} data-testid={slot.uid}>
          <DayCell
            slot={slot}
            mode="edit"
            collapsed={false}
            defaultSurplusPercentage={null}
            reorder={dnd.dayReorder?.slotUid === slot.uid ? dnd.dayReorder : null}
            onOpenSession={vi.fn()}
            onRequestAddSession={vi.fn()}
            onRemoveSession={vi.fn()}
          />
        </div>
      ))}
    </DndContext>
  );
}

function setup() {
  const api: { current: Api | null } = { current: null };
  const frames: Frame[] = [];
  over.set(null);
  render(<Harness api={api} frames={frames} />);
  act(() => api.current!.state.seed(draft()));
  const dragOf = (sessionUid: string, index: number) => {
    const data: SessionDragData = { type: "session", sessionUid, fromSlotUid: "slot-day1", index };
    return { id: sessionUid, data: { current: data } };
  };
  const overSlot = (slotUid: string) => ({
    id: slotUid,
    data: { current: { type: "day-slot", slotUid, sessionCount: 2 } },
  });
  return {
    frames,
    api,
    // The drag starts on a card of day 1, then dnd-kit finds the pointer over
    // day 1 in a commit of its own — before any move reaches the hook.
    start: (sessionUid: string, index: number) => {
      act(() => api.current!.dnd.handleDragStart({ active: dragOf(sessionUid, index) } as unknown as DragStartEvent));
      act(() => over.set("slot-day1"));
    },
    moveOverOwnDay: (sessionUid: string, index: number, place: number | null) =>
      act(() => {
        over.set("slot-day1");
        api.current!.dnd.handleDragMove({
          active: dragOf(sessionUid, index),
          collisions: [{ id: "slot-day1", data: { place } }],
        } as unknown as DragMoveEvent);
      }),
    moveOver: (sessionUid: string, index: number, slotUid: string) =>
      act(() => {
        over.set(slotUid);
        api.current!.dnd.handleDragMove({
          active: dragOf(sessionUid, index),
          collisions: [{ id: slotUid, data: {} }],
        } as unknown as DragMoveEvent);
      }),
    // dnd-kit clears `over` in the same batch as the drop.
    drop: (sessionUid: string, index: number, slotUid: string, place?: number | null) =>
      act(() => {
        over.set(null);
        api.current!.dnd.handleDragEnd({
          active: dragOf(sessionUid, index),
          over: overSlot(slotUid),
          collisions: [{ id: slotUid, data: place === undefined ? {} : { place } }],
        } as unknown as DragEndEvent);
      }),
    cancel: () =>
      act(() => {
        over.set(null);
        api.current!.dnd.handleDragCancel();
      }),
  };
}

describe("the frames of a day's session drag (frame test)", () => {
  beforeEach(() => cleanup());

  it("reorder within a day: the line follows the pointer, and the drop lands the card and clears the drag in one commit", () => {
    const view = setup();
    view.start("sess-am", 0);
    // Every frame of the start — including dnd-kit's, over the day the drag
    // began in, before the pointer moves again — shows the day as it was: no
    // line, and no border saying the session would join its own day.
    expect(view.frames.slice(-2)).toEqual([
      { day1: ["AM run", "PM lift"], day4: ["Upper"], lines: 0, lit: [], dragging: true },
      { day1: ["AM run", "PM lift"], day4: ["Upper"], lines: 0, lit: [], dragging: true },
    ]);

    // Over its own place: nothing to show.
    view.moveOverOwnDay("sess-am", 0, null);
    expect(view.frames.at(-1)?.lines).toBe(0);
    // Below the lift: one line, the order untouched.
    view.moveOverOwnDay("sess-am", 0, 2);
    expect(view.frames.at(-1)).toEqual({
      day1: ["AM run", "PM lift"],
      day4: ["Upper"],
      lines: 1,
      lit: [],
      dragging: true,
    });
    // The same place again renders nothing new.
    const before = view.frames.length;
    view.moveOverOwnDay("sess-am", 0, 2);
    expect(view.frames).toHaveLength(before);

    view.frames.length = 0;
    view.drop("sess-am", 0, "slot-day1", 2);
    // ONE commit, and it is already the settled screen.
    expect(view.frames).toEqual([
      { day1: ["PM lift", "AM run"], day4: ["Upper"], lines: 0, lit: [], dragging: false },
    ]);
  });

  it("join another day: the other day lights while hovered, and the drop moves the session and clears the drag — one commit", () => {
    const view = setup();
    view.start("sess-am", 0);
    view.moveOverOwnDay("sess-am", 0, 2);
    view.moveOver("sess-am", 0, "slot-day4");
    // Off its own day the line goes, and only the day it would join lights.
    expect(view.frames.at(-1)).toEqual({
      day1: ["AM run", "PM lift"],
      day4: ["Upper"],
      lines: 0,
      lit: ["slot-day4"],
      dragging: true,
    });
    view.frames.length = 0;
    view.drop("sess-am", 0, "slot-day4");
    expect(view.frames).toEqual([
      { day1: ["PM lift"], day4: ["Upper", "AM run"], lines: 0, lit: [], dragging: false },
    ]);
  });

  it("a drop over its own place changes nothing but the drag, in one commit", () => {
    const view = setup();
    view.start("sess-pm", 1);
    view.moveOverOwnDay("sess-pm", 1, null);
    view.frames.length = 0;
    view.drop("sess-pm", 1, "slot-day1", null);
    expect(view.frames).toEqual([
      { day1: ["AM run", "PM lift"], day4: ["Upper"], lines: 0, lit: [], dragging: false },
    ]);
    expect(view.api.current!.state.isDirty).toBe(false);
  });

  it("a cancelled drag clears the line and the drag in one commit and moves nothing", () => {
    const view = setup();
    view.start("sess-am", 0);
    view.moveOverOwnDay("sess-am", 0, 2);
    view.frames.length = 0;
    view.cancel();
    expect(view.frames).toEqual([
      { day1: ["AM run", "PM lift"], day4: ["Upper"], lines: 0, lit: [], dragging: false },
    ]);
  });
});
