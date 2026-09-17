import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { PAST_LOCKED } from "./program-builder-lock-model";
import { DayCell } from "./day-cell";
import type {
  DaySlotDraft,
  ExerciseDraft,
  ExerciseGroupDraft,
  SessionDraft,
} from "./program-builder-types";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";

function makeSession(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    uid: "sess-1",
    name: "Push",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [],
    ...overrides,
  };
}

// A lone exercise: a straight-sets group of one.
function lone(exercise: ExerciseDraft): ExerciseGroupDraft {
  return { uid: `grp-${exercise.uid}`, ...STRAIGHT_SETS, exercises: [exercise] };
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
        groups: [
          lone({
            uid: "ex-1",
            name: "Bench",
            sets: 3,
            repsMin: 8,
            repsMax: 12,
          } as ExerciseDraft),
          lone({ uid: "ex-2", name: "Fly", sets: 3, repsMin: 8, repsMax: 12 } as ExerciseDraft),
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

  it("joins a group's exercises on a rail and reads a superset's rounds; numbers run on", () => {
    const ex = (uid: string, name: string, overrides: Partial<ExerciseDraft> = {}) =>
      ({ uid, name, sets: 3, repsMin: 10, repsMax: 10, setSpecs: null, ...overrides }) as ExerciseDraft;
    renderCell({
      slot: makeSlot({
        isRest: false,
        session: makeSession({
          groups: [
            lone(ex("ex-1", "Back Squat", { repsMin: 5, repsMax: 5 })),
            {
              uid: "grp-circuit",
              ...STRAIGHT_SETS,
              format: "circuit",
              rounds: 3,
              exercises: [
                ex("ex-2", "Thruster", {
                  setSpecs: [
                    { set_number: 1, set_type: "working", reps_min: 21, reps_max: 21 },
                    { set_number: 2, set_type: "working", reps_min: 15, reps_max: 15 },
                    { set_number: 3, set_type: "working", reps_min: 9, reps_max: 9 },
                  ],
                }),
                ex("ex-3", "Pull Up"),
                ex("ex-4", "Burpee"),
              ],
            },
          ],
        }),
      }),
    });
    const rail = screen.getByTestId("day-cell-group-rail");
    // The first three exercises: the squat alone, then two of the circuit on its rail.
    expect(rail).toHaveTextContent("Thruster");
    expect(rail).toHaveTextContent("21-15-9");
    expect(rail).toHaveTextContent("Pull Up");
    expect(rail).toHaveTextContent("3×10");
    expect(rail).not.toHaveTextContent("Back Squat");
    expect(screen.getByText("3×5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
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

describe("DayCell — the plan editor's locked, greyed and today days", () => {
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
    expect(screen.getByTitle(PAST_LOCKED)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Clear session (back to rest)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Drag session")).not.toBeInTheDocument();
  });

  // The grid marks a greyed day locked as well (the day rules' `beyond` is part
  // of `locked`), so the cell gets both.
  it("a greyed rest cell shows no Rest label and offers no add", () => {
    const handlers = renderCell({ locked: true, greyed: true });
    const cell = document.querySelector<HTMLElement>(".group\\/rest");
    expect(cell).toHaveClass("bg-[rgba(147,176,180,0.12)]");
    expect(screen.queryByText("Rest")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add session to day 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Add session")).not.toBeInTheDocument();
    fireEvent.click(cell!);
    expect(handlers.onRequestAddSession).not.toHaveBeenCalled();
  });

  // Inside the box, on both variants: Day 1's left edge sits under the sticky
  // week column's opaque strip, which cut an outside ring off (the Edit plan
  // smoke). jsdom paints nothing, so the class is what can be asserted here.
  it("rings today's cell inside its box, rest or session", () => {
    renderCell({ isToday: true });
    expect(screen.getByLabelText("Add session to day 1")).toHaveClass(
      "ring-1",
      "ring-inset",
      "ring-[#0d9488]",
    );
    cleanup();

    renderCell({
      isToday: true,
      slot: makeSlot({ isRest: false, session: makeSession() }),
    });
    expect(screen.getByLabelText("Open session Push")).toHaveClass(
      "ring-1",
      "ring-inset",
      "ring-[#0d9488]",
    );
    cleanup();

    // Any other day carries no ring.
    renderCell({ slot: makeSlot({ isRest: false, session: makeSession() }) });
    expect(screen.getByLabelText("Open session Push")).not.toHaveClass("ring-1");
    expect(screen.getByLabelText("Open session Push")).not.toHaveClass("ring-inset");
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
    expect(screen.queryByTitle(PAST_LOCKED)).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Clear session (back to rest)"),
    ).toBeInTheDocument();
  });
});
