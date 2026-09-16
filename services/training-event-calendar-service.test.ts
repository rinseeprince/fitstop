import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

// Mock today-service (the calendar guards judge against client-local today)
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

// Inline query mock helper
function createMockQuery<T = unknown>(result: { data: T | null; error: { message: string } | null; count?: number | null }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };

  Object.defineProperty(mockQuery, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });

  return mockQuery;
}

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getTodayDateString } from "@/lib/date-helpers";
import { DateOccupiedError } from "./training-event-occupancy";
import {
  CalendarMoveDriftError,
  CalendarMoveNotFoundError,
  deleteEvent,
  moveEvent,
} from "./training-event-calendar-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockRpc = vi.mocked(supabaseAdmin.rpc);
const mockGetClientTodayString = vi.mocked(getClientTodayString);

describe("training-event-calendar-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: client-local today equals server today, so the pre-timezone
    // fixtures (which pin the clock via setSystemTime) behave unchanged.
    mockGetClientTodayString.mockImplementation(() =>
      Promise.resolve(getTodayDateString()),
    );
  });

  // =========================================================================
  // deleteEvent
  // =========================================================================

  describe("deleteEvent", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-15T12:00:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("validates ownership before deleting", async () => {
      const eventQuery = createMockQuery({
        data: {
          id: "event-1",
          client_id: "client-OTHER",
          training_plan_id: "plan-1",
          status: "scheduled",
          date: "2026-04-20",
        },
        error: null,
      });

      mockFrom.mockReturnValue(eventQuery as any);

      await expect(deleteEvent("event-1", "client-1", "plan-1")).rejects.toThrow(
        "Event does not belong to this client/plan"
      );
    });

    it("only deletes future scheduled events", async () => {
      const eventQuery = createMockQuery({
        data: {
          id: "event-1",
          client_id: "client-1",
          training_plan_id: "plan-1",
          status: "scheduled",
          date: "2026-04-20",
        },
        error: null,
      });
      const deleteQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return eventQuery as any; // fetch
        return deleteQuery as any; // delete
      });

      await deleteEvent("event-1", "client-1", "plan-1");

      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(deleteQuery.eq).toHaveBeenCalledWith("id", "event-1");
    });

    it("rejects completed events", async () => {
      const eventQuery = createMockQuery({
        data: {
          id: "event-1",
          client_id: "client-1",
          training_plan_id: "plan-1",
          status: "completed",
          date: "2026-04-20",
        },
        error: null,
      });

      mockFrom.mockReturnValue(eventQuery as any);

      await expect(deleteEvent("event-1", "client-1", "plan-1")).rejects.toThrow(
        "Only scheduled events can be deleted"
      );
    });

    it("rejects past events", async () => {
      const eventQuery = createMockQuery({
        data: {
          id: "event-1",
          client_id: "client-1",
          training_plan_id: "plan-1",
          status: "scheduled",
          date: "2026-04-10", // Before today (2026-04-15)
        },
        error: null,
      });

      mockFrom.mockReturnValue(eventQuery as any);

      await expect(deleteEvent("event-1", "client-1", "plan-1")).rejects.toThrow(
        "Cannot delete past events"
      );
    });
  });

  // =========================================================================
  // moveEvent
  // =========================================================================

  describe("moveEvent", () => {
    const clientId = "client-1";
    const planId = "plan-1";
    // The day the coach's calendar loaded the session on, and the drop target.
    const LOADED = "2026-04-27";
    const TARGET = "2026-04-30";
    const DRIFT =
      "This session moved since your calendar loaded. The calendar now shows where it is.";

    const storedEvent = (over: Record<string, unknown> = {}) => ({
      id: "event-1",
      client_id: clientId,
      training_plan_id: planId,
      date: LOADED,
      training_session_id: null,
      status: "scheduled",
      session_name: "Push",
      session_focus: null,
      estimated_calories: 300,
      is_modified: false,
      ...over,
    });

    /**
     * Wires the training_events reads moveEvent issues, in order: the event
     * itself, then assertDateFree's probe of the target day. The read count
     * shows where a refusal stopped; a direct write would be a third read.
     */
    function wire(event: Record<string, unknown> | null, occupants: { id: string }[] = []) {
      let reads = 0;
      mockFrom.mockImplementation(() => {
        reads += 1;
        return createMockQuery<unknown>(
          reads === 1 ? { data: event, error: null } : { data: occupants, error: null },
        ) as never;
      });
      return { reads: () => reads };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-20T12:00:00"));
      mockRpc.mockResolvedValue({ data: null, error: null } as never);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("moves the event through the week view's database function, as exactly one move", async () => {
      const { reads } = wire(storedEvent());

      await expect(moveEvent("event-1", LOADED, TARGET, clientId, planId)).resolves.toBeUndefined();

      // The function re-checks the from-date under a row lock and sets
      // is_modified and updated_at itself.
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith("move_training_events_atomic", {
        p_client_id: clientId,
        p_moves: [{ event_id: "event-1", from_date: LOADED, to_date: TARGET }],
      });
      // The event read and the occupancy probe only: nothing writes the table directly.
      expect(reads()).toBe(2);
    });

    it("refuses a session that moved since the calendar loaded, before calling the function", async () => {
      // The client moved it a day later from their own week view.
      const { reads } = wire(storedEvent({ date: "2026-04-28" }));

      const attempt = moveEvent("event-1", LOADED, TARGET, clientId, planId);

      await expect(attempt).rejects.toBeInstanceOf(CalendarMoveDriftError);
      await expect(attempt).rejects.toMatchObject({ message: DRIFT });
      expect(mockRpc).not.toHaveBeenCalled();
      // Refused on the event read alone, before the occupancy probe.
      expect(reads()).toBe(1);
    });

    it("refuses an event that has left the scheduled state", async () => {
      wire(storedEvent({ status: "completed" }));

      await expect(moveEvent("event-1", LOADED, TARGET, clientId, planId)).rejects.toThrow(
        "Only scheduled events can be moved",
      );
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("reads a missing event, or one that is not this client's or this plan's, as not found", async () => {
      for (const event of [
        null,
        storedEvent({ client_id: "client-OTHER" }),
        storedEvent({ training_plan_id: "plan-OTHER" }),
      ]) {
        wire(event);
        await expect(moveEvent("event-1", LOADED, TARGET, clientId, planId)).rejects.toBeInstanceOf(
          CalendarMoveNotFoundError,
        );
      }
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("refuses a move onto a day that already holds a session", async () => {
      // The guard this replaces matched on training_session_id, so it could
      // never fire once every placed day owned its own cloned session row —
      // which is how two sessions ended up stacked on dates no UI could clear.
      // The occupancy probe: a DIFFERENT session already sits on the target.
      wire(storedEvent({ training_session_id: "session-a" }), [{ id: "event-2" }]);

      await expect(moveEvent("event-1", LOADED, TARGET, clientId, planId)).rejects.toThrow(
        /already has a session/,
      );

      // Nothing was written: the function is never reached.
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("judges 'past' against client-local today, not server UTC (west-of-UTC boundary)", async () => {
      // LA client at ~17:30 PDT on 2026-06-09; the server's UTC day is already
      // 2026-06-10. Under the old UTC guard, moving an event to the client's
      // *today* (06-09) was rejected as a past date.
      vi.setSystemTime(new Date("2026-06-10T00:30:00Z"));
      mockGetClientTodayString.mockResolvedValue("2026-06-09");
      wire(storedEvent({ date: "2026-06-12" }));

      await expect(
        moveEvent("event-1", "2026-06-12", "2026-06-09", clientId, planId),
      ).resolves.toBeUndefined();

      expect(mockGetClientTodayString).toHaveBeenCalledWith(clientId);
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    it("still rejects dates before the client-local today", async () => {
      mockGetClientTodayString.mockResolvedValue("2026-06-09");
      wire(storedEvent({ date: "2026-06-12" }));

      await expect(
        moveEvent("event-1", "2026-06-12", "2026-06-08", clientId, planId),
      ).rejects.toThrow("Cannot move event to a past date");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("translates the function's message contract into the coach's errors", async () => {
      // Each refusal is one the function makes under its row lock — a client
      // move landing between the pre-checks above and the write.
      const attempt = (message: string) => {
        wire(storedEvent());
        mockRpc.mockResolvedValue({ data: null, error: { message } } as never);
        return moveEvent("event-1", LOADED, TARGET, clientId, planId);
      };

      const drift = attempt("drift: event event-1 is on 2026-04-28, not 2026-04-27");
      await expect(drift).rejects.toBeInstanceOf(CalendarMoveDriftError);
      await expect(drift).rejects.toMatchObject({ message: DRIFT });

      const occupied = attempt("occupied:2026-04-30");
      await expect(occupied).rejects.toBeInstanceOf(DateOccupiedError);
      await expect(occupied).rejects.toMatchObject({ message: "Thu, Apr 30 already has a session" });

      await expect(attempt("not_found: event event-1 is not this client's")).rejects.toBeInstanceOf(
        CalendarMoveNotFoundError,
      );
      await expect(
        attempt("not_scheduled: event event-1 has left the scheduled state"),
      ).rejects.toThrow("Only scheduled events can be moved");
    });

    it("translates the index backstop (a raw 23505) into the same sentence as the pre-check", async () => {
      wire(storedEvent());
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "idx_training_events_one_scheduled_per_day"',
          details: "Key (client_id, date)=(client-1, 2026-04-30) already exists.",
        },
      } as never);

      const attempt = moveEvent("event-1", LOADED, TARGET, clientId, planId);

      await expect(attempt).rejects.toBeInstanceOf(DateOccupiedError);
      await expect(attempt).rejects.toMatchObject({ message: "Thu, Apr 30 already has a session" });
    });
  });

  // =========================================================================
  // Client-local "today" anchoring for the remaining guards. Server clock is
  // 2026-06-10 (UTC); the client (west of UTC) is still on 2026-06-09. Each
  // guard must judge against the client's day or local-today operations break.
  // =========================================================================

  describe("client-local today anchoring (west-of-UTC boundary)", () => {
    const clientId = "client-1";
    const planId = "plan-1";

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-10T00:30:00Z"));
      mockGetClientTodayString.mockResolvedValue("2026-06-09");
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("deleteEvent allows deleting an event on the client's local today", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_events") {
          return createMockQuery({
            data: {
              id: "event-1",
              client_id: clientId,
              training_plan_id: planId,
              status: "scheduled",
              date: "2026-06-09", // client-local today; "past" under UTC
            },
            error: null,
          }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(deleteEvent("event-1", clientId, planId)).resolves.toBeUndefined();
      expect(mockGetClientTodayString).toHaveBeenCalledWith(clientId);
    });

  });
});
