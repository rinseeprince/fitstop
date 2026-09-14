import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { TrainingCalendarView } from "./training-calendar-view";
import type { TrainingEvent } from "@/types/training";
import type { PlacedSessionState } from "./use-placed-session-editor";

// The view as a HOST. jsdom never paints and Radix unmounts a closing node at
// once there, so the exit frame itself is not observable; the shape is. Every
// overlay is stubbed to expose the props it receives: after a close it must
// still hold the SAME subject with open=false, and the next open replaces it
// (CONVENTIONS §7 → "No frame disagrees").

const fixtures = vi.hoisted(() => {
  const makeEvent = (id: string, date: string) => ({
    id,
    clientId: "c1",
    trainingPlanId: "p1",
    trainingSessionId: `s-${id}`,
    date,
    sessionName: `Session ${id}`,
    sessionFocus: null,
    estimatedCalories: null,
    status: "scheduled" as const,
    sessionLogId: null,
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  // Far-future Mondays, so the clear-week guard (upcoming scheduled sessions
  // only) holds on any clock.
  const events = [makeEvent("ev1", "2099-01-05"), makeEvent("ev2", "2099-01-12")];
  return { events, trayStates: [] as Array<PlacedSessionState | null> };
});

vi.mock("@/hooks/use-calendar-events", () => ({
  useCalendarEvents: () => ({
    events: fixtures.events,
    eventsByDate: new Map(fixtures.events.map((e) => [e.date, [e]])),
    isLoading: false,
    mutate: () => Promise.resolve(),
  }),
  useInvalidateTrainingData: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => () => Promise.resolve(),
}));
vi.mock("@/components/clients/metrics/hooks/use-client-blocks", () => ({
  useClearBlockFacts: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-client-overview", () => ({
  useClearClientOverview: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-attention-feed", () => ({
  useClearAttentionFeed: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-saved-plans", () => ({
  useSavedPlans: () => ({ plans: [] }),
}));
vi.mock("@/hooks/use-calendar-dnd", () => ({
  useCalendarDnd: () => ({
    sensors: undefined,
    handleDragStart: () => {},
    handleDragCancel: () => {},
    handleDragEnd: () => {},
    activeEvent: null,
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("./calendar-toolbar", () => ({ CalendarToolbar: () => null }));
vi.mock("./calendar-event-card", () => ({ CalendarEventCard: () => null }));
vi.mock("./library-panel", () => ({ LibraryPanel: () => null }));
vi.mock("@/components/training-library/apply-to-client-dialog", () => ({
  ApplyToClientDialog: () => null,
}));

// The grid's three triggers, one set per event.
vi.mock("./calendar-grid", () => ({
  CalendarGrid: (p: {
    eventsByDate: Map<string, TrainingEvent[]>;
    onEventClick: (event: TrainingEvent) => void;
    onDelete: (event: TrainingEvent) => void;
    onWeekAction: (weekStartDate: string, action: "clear") => void;
  }) => (
    <div>
      {[...p.eventsByDate.values()].flat().map((e) => (
        <div key={e.id}>
          <button onClick={() => p.onEventClick(e)}>open {e.id}</button>
          <button onClick={() => p.onDelete(e)}>delete {e.id}</button>
          <button onClick={() => p.onWeekAction(e.date, "clear")}>clear {e.date}</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./delete-event-dialog", () => ({
  DeleteEventDialog: (p: {
    open: boolean;
    event: TrainingEvent | null;
    isDeleting: boolean;
    onCancel: () => void;
    onConfirm: (event: TrainingEvent) => void;
  }) => (
    <div
      data-testid="delete-dialog"
      data-open={String(p.open)}
      data-subject={p.event?.id ?? ""}
      data-pending={String(p.isDeleting)}
    >
      <button onClick={p.onCancel}>cancel delete</button>
      <button onClick={() => p.event && p.onConfirm(p.event)}>confirm delete</button>
    </div>
  ),
  ClearWeekDialog: (p: {
    open: boolean;
    weekStartDate: string | null;
    onCancel: () => void;
  }) => (
    <div
      data-testid="clear-week-dialog"
      data-open={String(p.open)}
      data-subject={p.weekStartDate ?? ""}
    >
      <button onClick={p.onCancel}>cancel clear</button>
    </div>
  ),
}));

vi.mock("./placed-session-editor", () => ({
  PlacedSessionEditor: (p: {
    open: boolean;
    state: PlacedSessionState | null;
    onClose: () => void;
  }) => {
    fixtures.trayStates.push(p.state);
    return (
      <div
        data-testid="tray"
        data-open={String(p.open)}
        data-subject={p.state?.eventId ?? ""}
      >
        <button onClick={p.onClose}>close tray</button>
      </div>
    );
  },
}));

function overlay(testId: string) {
  const el = screen.getByTestId(testId);
  return { open: el.dataset.open, subject: el.dataset.subject, pending: el.dataset.pending };
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function renderView() {
  render(<TrainingCalendarView clientId="c1" plan={null} editMode onUpdate={() => {}} />);
}

describe("TrainingCalendarView overlays: the subject outlives the close", () => {
  beforeEach(() => {
    fixtures.trayStates.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the delete confirm keeps its session through Cancel, and the next open replaces it", () => {
    renderView();

    click("delete ev1");
    expect(overlay("delete-dialog")).toMatchObject({ open: "true", subject: "ev1" });

    click("cancel delete");
    expect(overlay("delete-dialog")).toMatchObject({ open: "false", subject: "ev1" });

    click("delete ev2");
    expect(overlay("delete-dialog")).toMatchObject({ open: "true", subject: "ev2" });
  });

  it("a successful delete closes with its pending flag still set; the next open clears it", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    renderView();

    click("delete ev1");
    click("confirm delete");
    await waitFor(() => expect(overlay("delete-dialog").open).toBe("false"));
    expect(overlay("delete-dialog")).toMatchObject({ subject: "ev1", pending: "true" });

    click("delete ev2");
    expect(overlay("delete-dialog")).toMatchObject({
      open: "true",
      subject: "ev2",
      pending: "false",
    });
  });

  it("a failed delete stays open and clears its pending flag", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "Nope" }) }),
    );
    renderView();

    click("delete ev1");
    click("confirm delete");
    expect(overlay("delete-dialog").pending).toBe("true");
    await waitFor(() => expect(overlay("delete-dialog").pending).toBe("false"));
    expect(overlay("delete-dialog")).toMatchObject({ open: "true", subject: "ev1" });
  });

  it("a delete that cannot reach the server stays open and clears its pending flag", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    renderView();

    click("delete ev1");
    click("confirm delete");
    expect(overlay("delete-dialog").pending).toBe("true");
    await waitFor(() => expect(overlay("delete-dialog").pending).toBe("false"));
    expect(overlay("delete-dialog")).toMatchObject({ open: "true", subject: "ev1" });
  });

  it("the clear-week confirm keeps its week through Cancel, and the next open replaces it", () => {
    renderView();

    click("clear 2099-01-05");
    expect(overlay("clear-week-dialog")).toMatchObject({ open: "true", subject: "2099-01-05" });

    click("cancel clear");
    expect(overlay("clear-week-dialog")).toMatchObject({ open: "false", subject: "2099-01-05" });

    click("clear 2099-01-12");
    expect(overlay("clear-week-dialog")).toMatchObject({ open: "true", subject: "2099-01-12" });
  });

  it("the session tray keeps its subject through the close, and every open hands it a fresh one", () => {
    renderView();

    click("open ev1");
    expect(overlay("tray")).toMatchObject({ open: "true", subject: "ev1" });
    const first = fixtures.trayStates.at(-1);
    expect(first).toEqual({
      clientId: "c1",
      sessionId: "s-ev1",
      eventId: "ev1",
      planId: "p1",
      date: "2099-01-05",
    });

    click("close tray");
    expect(overlay("tray")).toMatchObject({ open: "false", subject: "ev1" });
    // The same object, not an equal one: the tray seeds once per subject.
    expect(fixtures.trayStates.at(-1)).toBe(first);

    // Re-opening the same day is a new opening, so the tray re-seeds.
    click("open ev1");
    expect(overlay("tray")).toMatchObject({ open: "true", subject: "ev1" });
    expect(fixtures.trayStates.at(-1)).not.toBe(first);

    click("close tray");
    click("open ev2");
    expect(overlay("tray")).toMatchObject({ open: "true", subject: "ev2" });
  });
});
