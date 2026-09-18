import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CalendarEventCard } from "./calendar-event-card";
import type { TrainingEvent } from "@/types/training";

// Session 7.86: the card's drag/delete gate (isFutureScheduled) is judged against
// clientToday — the CLIENT's local day — so the coach calendar agrees with the
// 7.82 server move/delete guards (which anchor on the client's tz). Here we drive
// the gate purely off the clientToday prop (no system-clock mocking). The
// draggable-disabled state is dnd-kit-internal, so we assert via the user-visible
// Delete menu trigger — the only real <button> ELEMENT the card renders
// (gated by the same isFutureScheduled flag). We query the `button` tag rather
// than role=button: when the event IS draggable, dnd-kit also stamps
// role="button" onto the card's root <div>, so a role query would match both.
function makeEvent(
  date: string,
  overrides: Partial<TrainingEvent> = {}
): TrainingEvent {
  return {
    id: "evt-1",
    clientId: "client-1",
    trainingPlanId: "plan-1",
    trainingSessionId: "session-1",
    date,
    sessionName: "Push Day",
    sessionFocus: "Chest",
    estimatedCalories: 400,
    status: "scheduled",
    sessionLogId: null,
    log: null,
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** The card's status thumb, as its lucide icon's own class names. */
function thumbIcon(event: TrainingEvent, clientToday: string): string {
  const { container } = render(
    <DndContext>
      <CalendarEventCard
        event={event}
        editMode={false}
        clientToday={clientToday}
        onEventClick={() => {}}
      />
    </DndContext>
  );
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

function menuTrigger(eventDate: string, clientToday: string): HTMLButtonElement | null {
  // useDraggable requires a DndContext ancestor.
  const { container } = render(
    <DndContext>
      <CalendarEventCard
        event={makeEvent(eventDate)}
        editMode
        clientToday={clientToday}
        onEventClick={() => {}}
        onDelete={() => {}}
      />
    </DndContext>
  );
  return container.querySelector("button");
}

describe("CalendarEventCard gating (Session 7.86)", () => {
  it("gates an event that is past on the CLIENT's calendar even though it's today on the device", () => {
    // Client is a day ahead (clientToday = device-tomorrow). An event dated the
    // device's today is the client's YESTERDAY → not draggable/deletable, matching
    // the 7.82 server guard (the old code keyed on the device day and wrongly
    // allowed it).
    expect(menuTrigger("2026-06-17", "2026-06-18")).toBeNull();
  });

  it("allows an event on (or after) the client's today", () => {
    expect(menuTrigger("2026-06-17", "2026-06-17")).not.toBeNull();
  });
});

describe("CalendarEventCard status thumb", () => {
  const LOG = {
    id: "log-1",
    performedSessionId: "session-1",
    notes: null,
  };

  it("shows a workout whose LOG is partial as partial, not as complete", () => {
    // The event says only that the client logged it; its log says how it went.
    const flipped = makeEvent("2026-06-15", {
      status: "completed",
      sessionLogId: "log-1",
      log: { ...LOG, completionQuality: "partial" },
    });
    expect(thumbIcon(flipped, "2026-06-17")).toContain("lucide-minus");
  });

  it("shows a workout logged in full as complete", () => {
    const event = makeEvent("2026-06-15", {
      status: "completed",
      sessionLogId: "log-1",
      log: { ...LOG, completionQuality: "full" },
    });
    expect(thumbIcon(event, "2026-06-17")).toContain("lucide-check");
  });

  it("shows a completed workout with no log at all as complete", () => {
    // 227 such rows on dev: logged before the link existed, so no quality was
    // ever recorded. They are complete workouts, not missing ones.
    const event = makeEvent("2026-06-15", { status: "completed" });
    expect(thumbIcon(event, "2026-06-17")).toContain("lucide-check");
  });

  it("derives missed for a workout still scheduled on a day that has passed", () => {
    expect(thumbIcon(makeEvent("2026-06-15"), "2026-06-17")).toContain("lucide-x");
    // Today is not missed — the client can still train later.
    expect(thumbIcon(makeEvent("2026-06-17"), "2026-06-17")).toContain("lucide-dumbbell");
  });
});
