import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => vi.fn(),
}));
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => vi.fn(),
}));

import { useCalendarDnd } from "./use-calendar-dnd";
import type { TrainingEvent } from "@/types/training";

// The gates under test judge "is this the past?" on the CLIENT's day. These
// dates are chosen so the coach's device day is irrelevant — no clock is mocked,
// because reading the system clock is exactly the bug.
const CLIENT_TODAY = "2026-07-27";

const event = (over: Partial<TrainingEvent> = {}): TrainingEvent =>
  ({
    id: "ev-1",
    clientId: "c1",
    trainingPlanId: "plan-1",
    trainingSessionId: "sess-1",
    sessionName: "Push Day",
    date: "2026-07-28",
    status: "scheduled",
    isModified: false,
    ...over,
  }) as TrainingEvent;

function setup(events: TrainingEvent[], overrides: Record<string, unknown> = {}) {
  const onLibraryPlanDrop = vi.fn();
  const onLibrarySessionDrop = vi.fn();
  const mutate = vi.fn();
  const { result } = renderHook(() =>
    useCalendarDnd({
      events,
      clientId: "c1",
      clientToday: CLIENT_TODAY,
      mutate: mutate as never,
      onLibraryPlanDrop,
      onLibrarySessionDrop,
      ...overrides,
    }),
  );
  return { result, onLibraryPlanDrop, onLibrarySessionDrop, mutate };
}

const dragStart = (id: string, type?: string) =>
  ({ active: { id, data: { current: type ? { type } : undefined } } }) as unknown as DragStartEvent;

const dragEnd = (id: string, overId: string | null, data?: Record<string, unknown>) =>
  ({
    active: { id, data: { current: data } },
    over: overId ? { id: overId } : null,
  }) as unknown as DragEndEvent;

describe("useCalendarDnd", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("drag start", () => {
    it("arms the drag preview for an event on the client's today", () => {
      const e = event({ date: CLIENT_TODAY });
      const { result } = setup([e]);
      act(() => result.current.handleDragStart(dragStart("ev-1")));
      expect(result.current.activeEvent).toEqual(e);
    });

    it("does not arm the preview for an event already in the client's past", () => {
      const { result } = setup([event({ date: "2026-07-26" })]);
      act(() => result.current.handleDragStart(dragStart("ev-1")));
      expect(result.current.activeEvent).toBeNull();
    });

    it("does not arm the preview for a non-scheduled event", () => {
      const { result } = setup([event({ status: "completed" })]);
      act(() => result.current.handleDragStart(dragStart("ev-1")));
      expect(result.current.activeEvent).toBeNull();
    });

    it("ignores library items (they have no calendar preview)", () => {
      const { result } = setup([event()]);
      act(() => result.current.handleDragStart(dragStart("lib-1", "library-session")));
      expect(result.current.activeEvent).toBeNull();
    });
  });

  describe("drop gates", () => {
    it("refuses to move an event into the client's past", () => {
      const { result, mutate } = setup([event()]);
      act(() => result.current.handleDragEnd(dragEnd("ev-1", "2026-07-26")));
      expect(mutate).not.toHaveBeenCalled();
      expect(mockToast.error).toHaveBeenCalledWith("Cannot move to past", {
        description: "Events can only be moved to today or future dates.",
      });
    });

    it("allows a move onto the client's today", () => {
      const { result, mutate } = setup([event()]);
      act(() => result.current.handleDragEnd(dragEnd("ev-1", CLIENT_TODAY)));
      expect(mutate).toHaveBeenCalled();
    });

    it("is a no-op when dropped back on its own date", () => {
      const { result, mutate } = setup([event({ date: "2026-07-28" })]);
      act(() => result.current.handleDragEnd(dragEnd("ev-1", "2026-07-28")));
      expect(mutate).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it("refuses a library PLAN drop into the client's past", () => {
      const { result, onLibraryPlanDrop } = setup([], {});
      act(() =>
        result.current.handleDragEnd(
          dragEnd("p1", "2026-07-26", { type: "library-plan", id: "p1" }),
        ),
      );
      expect(onLibraryPlanDrop).not.toHaveBeenCalled();
    });

    it("refuses a library SESSION drop into the client's past", () => {
      const { result, onLibrarySessionDrop } = setup([], {});
      act(() =>
        result.current.handleDragEnd(
          dragEnd("s1", "2026-07-26", { type: "library-session", id: "s1" }),
        ),
      );
      expect(onLibrarySessionDrop).not.toHaveBeenCalled();
    });

    it("accepts a library SESSION drop on the client's today", () => {
      const { result, onLibrarySessionDrop } = setup([], {});
      act(() =>
        result.current.handleDragEnd(
          dragEnd("s1", CLIENT_TODAY, { type: "library-session", id: "s1" }),
        ),
      );
      expect(onLibrarySessionDrop).toHaveBeenCalledWith("s1", CLIENT_TODAY);
    });
  });

  // The server refuses a move whose session has moved since the calendar
  // loaded, so the request carries the day the calendar showed it on.
  describe("move request", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("sends the day the calendar loaded the session on as fromDate, beside the drop target", async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { result, mutate } = setup([event({ date: "2026-07-28" })]);

      act(() => result.current.handleDragEnd(dragEnd("ev-1", "2026-07-30")));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // The optimistic update has already put the card on the target day.
      expect(mutate).toHaveBeenCalledWith(expect.any(Function), { revalidate: false });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/clients/c1/training/plan-1/events/ev-1/move");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        targetDate: "2026-07-30",
        fromDate: "2026-07-28",
      });
    });

    it("the optimistic update puts the moved card LAST on its new day, as the server will", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }),
        ),
      );
      const moving = event({ id: "ev-1", date: "2026-07-28" });
      const resident = event({ id: "ev-2", date: "2026-07-30" });
      const { result, mutate } = setup([moving, resident]);

      act(() => result.current.handleDragEnd(dragEnd("ev-1", "2026-07-30")));

      await vi.waitFor(() =>
        expect(mutate).toHaveBeenCalledWith(expect.any(Function), { revalidate: false }),
      );
      const update = mutate.mock.calls[0][0] as (current: { events: TrainingEvent[] }) => {
        events: TrainingEvent[];
      };
      const next = update({ events: [moving, resident] });
      // The calendar lays a day in list order: the resident first, the arrival after it.
      expect(next.events.map((e) => [e.id, e.date])).toEqual([
        ["ev-2", "2026-07-30"],
        ["ev-1", "2026-07-30"],
      ]);
    });

    it("a refused move refetches the calendar and shows the server's sentence", async () => {
      const drift =
        "This session moved since your calendar loaded. The calendar now shows where it is.";
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: drift }) }),
        ),
      );
      const { result, mutate } = setup([event()]);

      act(() => result.current.handleDragEnd(dragEnd("ev-1", "2026-07-30")));

      await vi.waitFor(() =>
        expect(mockToast.error).toHaveBeenCalledWith("Move failed", { description: drift }),
      );
      // The revert is a refetch — a bare mutate() — so the calendar shows
      // where the session now is.
      expect(mutate).toHaveBeenLastCalledWith();
    });
  });

  describe("drag cancel", () => {
    it("clears the preview so the next drag can't show the previous card", () => {
      const { result } = setup([event({ date: CLIENT_TODAY })]);
      act(() => result.current.handleDragStart(dragStart("ev-1")));
      expect(result.current.activeEvent).not.toBeNull();
      act(() => result.current.handleDragCancel());
      expect(result.current.activeEvent).toBeNull();
    });
  });
});
