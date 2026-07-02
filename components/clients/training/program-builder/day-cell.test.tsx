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
          { uid: "ex-1" } as SessionDraft["exercises"][number],
          { uid: "ex-2" } as SessionDraft["exercises"][number],
        ],
        calorieSurplusPercentage: 12,
      }),
    });

  it("shows name, exercise count, surplus badge; click opens the editor", () => {
    const handlers = renderCell({ slot: sessionSlot() });
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("2 exercises")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Push"));
    expect(handlers.onOpenSession).toHaveBeenCalledWith("sess-1");
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
