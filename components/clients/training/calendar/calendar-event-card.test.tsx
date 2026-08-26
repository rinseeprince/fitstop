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
// Duplicate/Delete menu trigger — the only real <button> ELEMENT the card renders
// (gated by the same isFutureScheduled flag). We query the `button` tag rather
// than role=button: when the event IS draggable, dnd-kit also stamps
// role="button" onto the card's root <div>, so a role query would match both.
function makeEvent(date: string): TrainingEvent {
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
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
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
        onDuplicate={() => {}}
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

describe("done-on-another-day receipt", () => {
  it("shows 'Done {weekday day}' when loggedOn differs from the event date, and nothing otherwise", () => {
    const withReceipt = { ...makeEvent("2026-05-08"), status: "completed" as const, sessionLogId: "log-1", loggedOn: "2026-05-05" };
    const { container, unmount } = render(
      <DndContext>
        <CalendarEventCard event={withReceipt} editMode={false} clientToday="2026-05-10" onEventClick={() => {}} />
      </DndContext>,
    );
    expect(container.textContent).toMatch(/Done Tue 5/);
    unmount();

    const sameDay = { ...withReceipt, loggedOn: null };
    const { container: c2 } = render(
      <DndContext>
        <CalendarEventCard event={sameDay} editMode={false} clientToday="2026-05-10" onEventClick={() => {}} />
      </DndContext>,
    );
    expect(c2.textContent).not.toMatch(/Done/);
  });
});
