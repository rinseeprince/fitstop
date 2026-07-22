import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { DayCell } from "./day-cell";
import type { DaySlotDraft, SessionDraft } from "./program-builder-types";

function makeSession(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    uid: "sess-1",
    name: "Push",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [],
    ...overrides,
  };
}

function makeSlot(overrides: Partial<DaySlotDraft> = {}): DaySlotDraft {
  return { uid: "slot-1", orderIndex: 0, isRest: true, session: null, ...overrides };
}

function renderCell(props: Partial<Parameters<typeof DayCell>[0]> = {}) {
  const handlers = {
    onOpenSession: vi.fn(),
    onRequestAddSession: vi.fn(),
    onClearSlot: vi.fn(),
  };
  render(
    <DndContext>
      <DayCell
        slot={makeSlot()}
        mode="edit"
        collapsed={false}
        defaultSurplusPercentage={null}
        {...handlers}
        {...props}
      />
    </DndContext>,
  );
  return handlers;
}

describe("DayCell — rest state (empty === rest)", () => {
  beforeEach(() => cleanup());

  it("requests the add-session popover with the slot + anchor on click", () => {
    const handlers = renderCell();
    expect(screen.getByText("Rest")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rest"));
    expect(handlers.onRequestAddSession).toHaveBeenCalledTimes(1);
    const [slot, anchor] = handlers.onRequestAddSession.mock.calls[0];
    expect(slot.uid).toBe("slot-1");
    expect(anchor).toBeInstanceOf(HTMLElement);
  });

  it("view mode shows the rest marker but no add affordance", () => {
    const handlers = renderCell({ mode: "view" });
    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(screen.queryByText(/Add session/)).toBeNull();
    fireEvent.click(screen.getByText("Rest"));
    expect(handlers.onRequestAddSession).not.toHaveBeenCalled();
  });
});

describe("DayCell — session state", () => {
  beforeEach(() => cleanup());

  const sessionSlot = () =>
    makeSlot({
      isRest: false,
      session: makeSession({
        exercises: [
          {
            uid: "ex-1",
            name: "Bench",
            sets: 3,
            repsMin: 8,
            repsMax: 12,
          } as SessionDraft["exercises"][number],
          { uid: "ex-2", name: "Fly", sets: 3, repsMin: 8, repsMax: 12 } as SessionDraft["exercises"][number],
        ],
        calorieSurplusPercentage: 12,
      }),
    });

  it("shows name, the exercise list with sets×reps, and count; click opens the editor", () => {
    const handlers = renderCell({ slot: sessionSlot() });
    expect(screen.getByText("Push")).toBeInTheDocument();
    // Ordered exercise list (session card renders name + sets×reps).
    expect(screen.getByText("Bench")).toBeInTheDocument();
    expect(screen.getAllByText("3×8-12")).toHaveLength(2);
    expect(screen.getByText("2 exercises")).toBeInTheDocument();
    // Custom (per-day override) surplus reads in teal on the card.
    expect(screen.getByText("+12%")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Push"));
    expect(handlers.onOpenSession).toHaveBeenCalledWith("sess-1");
  });

  it("inherits the program default surplus when the session has no override", () => {
    renderCell({
      slot: makeSlot({
        isRest: false,
        session: makeSession({ calorieSurplusPercentage: null }),
      }),
      defaultSurplusPercentage: 20,
    });
    // The effective surplus shows the program default (inherited).
    expect(screen.getByText("+20%")).toBeInTheDocument();
  });

  it("shows no surplus badge when neither the session nor the program has one", () => {
    renderCell({
      slot: makeSlot({
        isRest: false,
        session: makeSession({ calorieSurplusPercentage: null }),
      }),
      defaultSurplusPercentage: null,
    });
    expect(screen.queryByText(/^\+\d+%$/)).toBeNull();
  });

  it("quick-clear turns the cell back into rest without opening the editor", () => {
    const handlers = renderCell({ slot: sessionSlot() });
    fireEvent.click(screen.getByLabelText("Clear session (back to rest)"));
    expect(handlers.onClearSlot).toHaveBeenCalledWith("slot-1");
    expect(handlers.onOpenSession).not.toHaveBeenCalled();
  });

  it("view mode hides the clear + drag affordances", () => {
    renderCell({ slot: sessionSlot(), mode: "view" });
    expect(screen.queryByLabelText("Clear session (back to rest)")).toBeNull();
    expect(screen.queryByLabelText("Drag session")).toBeNull();
  });

  it("collapsed variant renders just the session name", () => {
    renderCell({ slot: sessionSlot(), collapsed: true });
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.queryByText("2 exercises")).toBeNull();
  });
});

describe("DayCell — locked (placed-plan history)", () => {
  beforeEach(() => cleanup());

  it("a locked rest cell is inert: no add affordance, no popover on click", () => {
    const handlers = renderCell({ locked: true });
    expect(screen.getByText("Rest")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rest"));
    expect(handlers.onRequestAddSession).not.toHaveBeenCalled();
    expect(screen.queryByText("Add session")).not.toBeInTheDocument();
  });

  it("a locked session card shows the lock marker and hides clear/grip", () => {
    renderCell({
      locked: true,
      slot: makeSlot({ isRest: false, session: makeSession() }),
    });
    expect(screen.getByTitle("This day already happened")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Clear session (back to rest)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Drag session")).not.toBeInTheDocument();
  });

  it("a locked session card STAYS clickable (opens the editor read-only)", () => {
    const handlers = renderCell({
      locked: true,
      slot: makeSlot({ isRest: false, session: makeSession() }),
    });
    fireEvent.click(screen.getByLabelText("Open session Push"));
    expect(handlers.onOpenSession).toHaveBeenCalledWith("sess-1");
  });

  it("an unlocked session card keeps its edit affordances", () => {
    renderCell({
      slot: makeSlot({ isRest: false, session: makeSession() }),
    });
    expect(screen.queryByTitle("This day already happened")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Clear session (back to rest)"),
    ).toBeInTheDocument();
  });
});
