import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
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
import {
  deleteEvent,
  duplicateEvent,
  moveEvent,
} from "./training-event-calendar-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
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

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-20T12:00:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns the original event date as sourceDate and the newDate as targetDate", async () => {
      const existingEvent = {
        id: "event-1",
        client_id: clientId,
        training_plan_id: planId,
        date: "2026-04-27",
        training_session_id: null,
        status: "scheduled",
        session_name: "Push",
        session_focus: null,
        estimated_calories: 300,
        is_modified: false,
      };

      let fromCallIndex = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") {
          return createMockQuery({ data: null, error: null }) as any;
        }
        if (table === "training_events") {
          fromCallIndex++;
          if (fromCallIndex === 1) {
            // Initial event fetch.
            return createMockQuery({ data: existingEvent, error: null }) as any;
          }
          // Update call.
          return createMockQuery({ data: null, error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await moveEvent("event-1", "2026-04-30", clientId, planId);

      expect(result).toEqual({ sourceDate: "2026-04-27", targetDate: "2026-04-30" });
    });

    it("refuses a move onto a day that already holds a session", async () => {
      // The guard this replaces matched on training_session_id, so it could
      // never fire once every placed day owned its own cloned session row —
      // which is how two sessions ended up stacked on dates no UI could clear.
      const existingEvent = {
        id: "event-1",
        client_id: clientId,
        training_plan_id: planId,
        date: "2026-04-27",
        training_session_id: "session-a",
        status: "scheduled",
        session_name: "Push",
        session_focus: null,
        estimated_calories: 300,
        is_modified: false,
      };

      let fromCallIndex = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_events") {
          fromCallIndex++;
          if (fromCallIndex === 1) {
            return createMockQuery({ data: existingEvent, error: null }) as any;
          }
          // The occupancy probe: a DIFFERENT session already sits on 04-30.
          return createMockQuery({ data: [{ id: "event-2" }], error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(
        moveEvent("event-1", "2026-04-30", clientId, planId),
      ).rejects.toThrow(/already has a session/);

      // Nothing was written: the update would have been the 3rd query.
      expect(fromCallIndex).toBe(2);
    });

    it("judges 'past' against client-local today, not server UTC (west-of-UTC boundary)", async () => {
      // LA client at ~17:30 PDT on 2026-06-09; the server's UTC day is already
      // 2026-06-10. Under the old UTC guard, moving an event to the client's
      // *today* (06-09) was rejected as a past date.
      vi.setSystemTime(new Date("2026-06-10T00:30:00Z"));
      mockGetClientTodayString.mockResolvedValue("2026-06-09");

      const existingEvent = {
        id: "event-1",
        client_id: clientId,
        training_plan_id: planId,
        date: "2026-06-12",
        training_session_id: null,
        status: "scheduled",
        session_name: "Push",
        session_focus: null,
        estimated_calories: 300,
        is_modified: false,
      };

      let fromCallIndex = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") {
          return createMockQuery({ data: null, error: null }) as any;
        }
        if (table === "training_events") {
          fromCallIndex++;
          if (fromCallIndex === 1) {
            return createMockQuery({ data: existingEvent, error: null }) as any;
          }
          return createMockQuery({ data: null, error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await moveEvent("event-1", "2026-06-09", clientId, planId);

      expect(result).toEqual({ sourceDate: "2026-06-12", targetDate: "2026-06-09" });
      expect(mockGetClientTodayString).toHaveBeenCalledWith(clientId);
    });

    it("still rejects dates before the client-local today", async () => {
      mockGetClientTodayString.mockResolvedValue("2026-06-09");

      const existingEvent = {
        id: "event-1",
        client_id: clientId,
        training_plan_id: planId,
        date: "2026-06-12",
        training_session_id: null,
        status: "scheduled",
        session_name: "Push",
        session_focus: null,
        estimated_calories: 300,
        is_modified: false,
      };
      mockFrom.mockReturnValue(
        createMockQuery({ data: existingEvent, error: null }) as any,
      );

      await expect(
        moveEvent("event-1", "2026-06-08", clientId, planId),
      ).rejects.toThrow("Cannot move event to a past date");
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

    it("duplicateEvent allows duplicating onto the client's local today", async () => {
      let eventCalls = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_events") {
          eventCalls++;
          if (eventCalls === 1) {
            // Source fetch. No training_session_id -> conflict check skipped.
            return createMockQuery({
              data: {
                id: "event-1",
                client_id: clientId,
                training_plan_id: planId,
                training_session_id: null,
                session_name: "Push",
                session_focus: null,
                estimated_calories: 300,
                calorie_surplus_percentage: null,
                status: "scheduled",
                date: "2026-06-12",
              },
              error: null,
            }) as any;
          }
          // Insert of the duplicate.
          return createMockQuery({ data: { id: "event-2" }, error: null }) as any;
        }
        if (table === "training_plans") {
          return createMockQuery({ data: null, error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(
        duplicateEvent("event-1", "2026-06-09", clientId, planId),
      ).resolves.toBe("event-2");
      expect(mockGetClientTodayString).toHaveBeenCalledWith(clientId);
    });

  });
});
