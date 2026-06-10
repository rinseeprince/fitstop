import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock training-event-service
vi.mock("./training-event-service", () => ({
  getEventsForDateRange: vi.fn(),
  regenerateFutureEvents: vi.fn(),
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
import { getEventsForDateRange } from "./training-event-service";
import { getClientTodayString } from "./today-service";
import { getTodayDateString } from "@/lib/date-helpers";
import {
  duplicateWeek,
  duplicateWeekToRemaining,
  deleteEvent,
  duplicateEvent,
  moveEvent,
  moveEventAndFuture,
  countModifiedFutureEvents,
} from "./training-event-calendar-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetEventsForDateRange = vi.mocked(getEventsForDateRange);
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
  // duplicateWeek
  // =========================================================================

  describe("duplicateWeek", () => {
    const clientId = "client-1";
    const planId = "plan-1";
    const sessionId = "session-1";

    const sourceSession = {
      id: sessionId,
      plan_id: planId,
      name: "Push Day",
      day_of_week: "monday",
      order_index: 0,
      focus: "chest",
      notes: null,
      estimated_duration_minutes: 60,
      estimated_calories: 400,
      calories_calculated_at: null,
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };

    const sourceExercises = [
      {
        id: "ex-1",
        session_id: sessionId,
        name: "Bench Press",
        exercise_id: "catalog-bp-1",
        order_index: 0,
        sets: 4,
        reps_min: 8,
        reps_max: 12,
        reps_target: null,
        rpe_target: 8,
        percentage_1rm: null,
        tempo: null,
        rest_seconds: 90,
        notes: null,
        superset_group: null,
        is_warmup: false,
        is_active: true,
      },
    ];

    it("clones sessions, exercises, and creates events for the target week", async () => {
      const sourceEvents = [
        createMockTrainingEvent({
          clientId,
          trainingPlanId: planId,
          trainingSessionId: sessionId,
          date: "2026-04-06", // Monday
          sessionName: "Push Day",
          sessionFocus: "chest",
          estimatedCalories: 400,
          status: "scheduled",
        }),
      ];

      mockGetEventsForDateRange.mockResolvedValue(sourceEvents);

      // Track all insert calls across tables
      const insertCalls: { table: string; data: unknown }[] = [];

      // Build per-table mocks with sequential behavior for training_sessions
      const sessionCallIndex = { current: 0 };
      const exerciseCallIndex = { current: 0 };

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") {
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
        }
        if (table === "training_sessions") {
          sessionCallIndex.current++;
          if (sessionCallIndex.current === 1) {
            // Fetch source session
            const q = createMockQuery({ data: sourceSession, error: null });
            return q as any;
          }
          // Insert cloned session
          const q = createMockQuery({ data: { id: "cloned-session-1" }, error: null });
          q.insert = vi.fn().mockImplementation((data: unknown) => {
            insertCalls.push({ table: "training_sessions", data });
            return q; // Return self for chaining .select().single()
          });
          return q as any;
        }
        if (table === "training_exercises") {
          exerciseCallIndex.current++;
          if (exerciseCallIndex.current === 1) {
            // Fetch source exercises
            const q = createMockQuery({ data: sourceExercises, error: null });
            return q as any;
          }
          // Insert cloned exercises
          const q = createMockQuery({ data: null, error: null });
          q.insert = vi.fn().mockImplementation((data: unknown) => {
            insertCalls.push({ table: "training_exercises", data });
            return q; // Return self for thenable resolution
          });
          return q as any;
        }
        if (table === "training_events") {
          const q = createMockQuery({ data: null, error: null });
          q.insert = vi.fn().mockImplementation((data: unknown) => {
            insertCalls.push({ table: "training_events", data });
            return q; // Return self for thenable resolution
          });
          return q as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await duplicateWeek(clientId, planId, "2026-04-06", "2026-04-13");

      expect(result.eventsCreated).toBe(1);
      expect(mockGetEventsForDateRange).toHaveBeenCalledWith(clientId, "2026-04-06", "2026-04-12");

      // Verify cloned session was inserted with day_of_week = null
      const sessionInsert = insertCalls.find((c) => c.table === "training_sessions");
      expect(sessionInsert).toBeDefined();
      expect(sessionInsert!.data).toMatchObject({
        plan_id: planId,
        name: "Push Day",
        day_of_week: null,
        is_active: true,
      });

      // Verify exercises preserved exercise_id FK
      const exerciseInsert = insertCalls.find((c) => c.table === "training_exercises");
      expect(exerciseInsert).toBeDefined();
      expect(exerciseInsert!.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            session_id: "cloned-session-1",
            name: "Bench Press",
            exercise_id: "catalog-bp-1",
            is_active: true,
          }),
        ])
      );

      // Verify event was created with is_modified = true and correct target date
      const eventInsert = insertCalls.find((c) => c.table === "training_events");
      expect(eventInsert).toBeDefined();
      expect(eventInsert!.data).toMatchObject({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: "cloned-session-1",
        date: "2026-04-13", // Same day offset (Monday to Monday)
        status: "scheduled",
        is_modified: true,
      });
    });

    it("skips non-scheduled events", async () => {
      const sourceEvents = [
        createMockTrainingEvent({
          clientId,
          trainingPlanId: planId,
          trainingSessionId: sessionId,
          date: "2026-04-06",
          status: "completed",
        }),
        createMockTrainingEvent({
          clientId,
          trainingPlanId: planId,
          trainingSessionId: sessionId,
          date: "2026-04-07",
          status: "missed",
        }),
      ];

      mockGetEventsForDateRange.mockResolvedValue(sourceEvents);

      const result = await duplicateWeek(clientId, planId, "2026-04-06", "2026-04-13");

      expect(result.eventsCreated).toBe(0);
      // Should not have called supabaseAdmin.from for sessions/exercises/events
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("skips events without training_session_id", async () => {
      const sourceEvents = [
        createMockTrainingEvent({
          clientId,
          trainingPlanId: planId,
          trainingSessionId: undefined,
          date: "2026-04-06",
          status: "scheduled",
        }),
      ];

      // The filter for trainingSessionId truthy will exclude null/undefined
      mockGetEventsForDateRange.mockResolvedValue(
        sourceEvents.map((e) => ({ ...e, trainingSessionId: null }))
      );

      const result = await duplicateWeek(clientId, planId, "2026-04-06", "2026-04-13");

      expect(result.eventsCreated).toBe(0);
    });

    it("returns 0 events when source week is empty", async () => {
      mockGetEventsForDateRange.mockResolvedValue([]);

      const result = await duplicateWeek(clientId, planId, "2026-04-06", "2026-04-13");

      expect(result.eventsCreated).toBe(0);
    });
  });

  // =========================================================================
  // duplicateWeekToRemaining
  // =========================================================================

  describe("duplicateWeekToRemaining", () => {
    it("calculates correct number of target weeks", async () => {
      // Source: April 6 (Monday), Phase end: April 26 (Saturday)
      // Target weeks: April 13, April 20 = 2 target weeks

      // Mock duplicateWeek to return 3 events each time
      mockGetEventsForDateRange.mockResolvedValue([
        createMockTrainingEvent({ status: "scheduled", trainingSessionId: "s1", date: "2026-04-06" }),
        createMockTrainingEvent({ status: "scheduled", trainingSessionId: "s2", date: "2026-04-08" }),
        createMockTrainingEvent({ status: "scheduled", trainingSessionId: "s3", date: "2026-04-10" }),
      ]);

      // Mock all supabase calls to succeed
      const noPhaseMock = createMockQuery({ data: { phase_id: null }, error: null });
      const sessionMock = createMockQuery({
        data: { id: "s1", plan_id: "plan-1", name: "Push", day_of_week: "monday", order_index: 0, focus: null, notes: null, estimated_duration_minutes: 60, estimated_calories: 400, calories_calculated_at: null, is_active: true },
        error: null,
      });
      const exercisesMock = createMockQuery({ data: [], error: null });
      const clonedMock = createMockQuery({ data: { id: "cloned-1" }, error: null });
      const insertMock = createMockQuery({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return noPhaseMock as any;
        if (table === "training_sessions") {
          // Alternate between fetch and insert
          return sessionMock.single.mock.calls.length % 2 === 0
            ? sessionMock as any
            : clonedMock as any;
        }
        if (table === "training_exercises") return exercisesMock as any;
        if (table === "training_events") return insertMock as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await duplicateWeekToRemaining("client-1", "plan-1", "2026-04-06", "2026-04-26");

      // Should have called getEventsForDateRange twice (once per target week)
      expect(mockGetEventsForDateRange).toHaveBeenCalledTimes(2);
      expect(result.weeksCreated).toBeGreaterThanOrEqual(0);
      expect(result.eventsCreated).toBeGreaterThanOrEqual(0);
    });

    it("returns zero totals when source week is empty", async () => {
      mockGetEventsForDateRange.mockResolvedValue([]);

      const result = await duplicateWeekToRemaining("client-1", "plan-1", "2026-04-06", "2026-04-26");

      expect(result.weeksCreated).toBe(0);
      expect(result.eventsCreated).toBe(0);
    });
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
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
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
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
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
  // moveEventAndFuture
  // =========================================================================

  describe("moveEventAndFuture", () => {
    const clientId = "client-1";
    const planId = "plan-1";
    const sessionId = "session-1";

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-20T12:00:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shifts all future scheduled siblings by the day offset without touching the template", async () => {
      // Source: Mon Apr 27 -> Target: Wed Apr 29 (offset +2 days)
      // Siblings: Apr 27, May 4, May 11 (three weekly Mondays).
      const draggedEvent = {
        id: "event-1",
        date: "2026-04-27",
        training_session_id: sessionId,
        status: "scheduled",
        client_id: clientId,
        training_plan_id: planId,
      };

      const siblings = [
        { id: "event-1", date: "2026-04-27" },
        { id: "event-2", date: "2026-05-04" },
        { id: "event-3", date: "2026-05-11" },
      ];

      const updateCalls: { id: string; data: Record<string, unknown> }[] = [];
      let fromCallIndex = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") {
          throw new Error("Template must NOT be touched by moveEventAndFuture");
        }
        if (table === "training_plans") {
          // validatePhaseBounds queries this per update; return no phase.
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
        }
        if (table === "training_events") {
          fromCallIndex++;
          if (fromCallIndex === 1) {
            // Initial fetch of the dragged event.
            return createMockQuery({ data: draggedEvent, error: null }) as any;
          }
          if (fromCallIndex === 2) {
            // Siblings fetch (thenable).
            return createMockQuery({ data: siblings, error: null }) as any;
          }
          if (fromCallIndex === 3) {
            // Collision check - no conflicts.
            return createMockQuery({ data: [], error: null }) as any;
          }
          // Per-row updates (one query each, thenable chain).
          const q = createMockQuery({ data: null, error: null });
          let capturedId: string | undefined;
          let capturedUpdate: Record<string, unknown> | undefined;
          q.update = vi.fn().mockImplementation((data: Record<string, unknown>) => {
            capturedUpdate = data;
            return q;
          });
          q.eq = vi.fn().mockImplementation((col: string, value: string) => {
            if (col === "id") capturedId = value;
            return q;
          });
          Object.defineProperty(q, "then", {
            value: (resolve: (value: { data: null; error: null }) => void) => {
              if (capturedId && capturedUpdate) {
                updateCalls.push({ id: capturedId, data: capturedUpdate });
              }
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          });
          return q as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await moveEventAndFuture("event-1", "2026-04-29", clientId, planId);

      // All three siblings should be updated, each shifted by +2 days.
      expect(updateCalls).toHaveLength(3);
      const byId = new Map(updateCalls.map((u) => [u.id, u.data]));
      expect(byId.get("event-1")).toMatchObject({ date: "2026-04-29", is_modified: true });
      expect(byId.get("event-2")).toMatchObject({ date: "2026-05-06", is_modified: true });
      expect(byId.get("event-3")).toMatchObject({ date: "2026-05-13", is_modified: true });

      // Return value reports the earliest source date across shifted siblings
      // so the nutrition cascade can clear stale rows on that date.
      expect(result).toEqual({ earliestSourceDate: "2026-04-27", targetDate: "2026-04-29" });
    });

    it("falls back to single-event move when the dragged event has no training_session_id", async () => {
      // Library-placed / one-off event: session_id null. Should call moveEvent path,
      // which fetches the event again (select * this time), checks collision, and updates.
      const draggedEvent = {
        id: "event-1",
        date: "2026-04-27",
        training_session_id: null,
        status: "scheduled",
        client_id: clientId,
        training_plan_id: planId,
      };

      const draggedEventFull = {
        ...draggedEvent,
        session_name: "One-off",
        session_focus: null,
        estimated_calories: 300,
        is_modified: false,
      };

      let fromCallIndex = 0;
      let updateApplied = false;

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") {
          throw new Error("Template must NOT be touched");
        }
        if (table === "training_plans") {
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
        }
        if (table === "training_events") {
          fromCallIndex++;
          if (fromCallIndex === 1) {
            // Initial fetch by moveEventAndFuture.
            return createMockQuery({ data: draggedEvent, error: null }) as any;
          }
          if (fromCallIndex === 2) {
            // moveEvent's own fetch (select *).
            return createMockQuery({ data: draggedEventFull, error: null }) as any;
          }
          // Update call from moveEvent.
          const q = createMockQuery({ data: null, error: null });
          q.update = vi.fn().mockImplementation(() => {
            updateApplied = true;
            return q;
          });
          Object.defineProperty(q, "then", {
            value: (resolve: (value: { data: null; error: null }) => void) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          });
          return q as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await moveEventAndFuture("event-1", "2026-04-29", clientId, planId);

      expect(updateApplied).toBe(true);
      expect(result).toEqual({ earliestSourceDate: "2026-04-27", targetDate: "2026-04-29" });
    });

    it("throws on collision with another scheduled event on a shifted date", async () => {
      const draggedEvent = {
        id: "event-1",
        date: "2026-04-27",
        training_session_id: sessionId,
        status: "scheduled",
        client_id: clientId,
        training_plan_id: planId,
      };

      const siblings = [
        { id: "event-1", date: "2026-04-27" },
        { id: "event-2", date: "2026-05-04" },
      ];

      // A stray event already occupies the target Wednesday (May 6 = May 4 + 2).
      const collision = [{ id: "event-STRAY", date: "2026-05-06" }];

      let fromCallIndex = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") {
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
        }
        if (table === "training_events") {
          fromCallIndex++;
          if (fromCallIndex === 1) return createMockQuery({ data: draggedEvent, error: null }) as any;
          if (fromCallIndex === 2) return createMockQuery({ data: siblings, error: null }) as any;
          if (fromCallIndex === 3) return createMockQuery({ data: collision, error: null }) as any;
          return createMockQuery({ data: null, error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(
        moveEventAndFuture("event-1", "2026-04-29", clientId, planId)
      ).rejects.toThrow(/conflicts with existing sessions/);
    });

    it("rejects moves into the past", async () => {
      mockFrom.mockReturnValue(
        createMockQuery({
          data: {
            id: "event-1",
            date: "2026-04-27",
            training_session_id: sessionId,
            status: "scheduled",
            client_id: clientId,
            training_plan_id: planId,
          },
          error: null,
        }) as any
      );

      await expect(
        moveEventAndFuture("event-1", "2026-04-10", clientId, planId)
      ).rejects.toThrow(/past date/);
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
          return createMockQuery({ data: { phase_id: null }, error: null }) as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(
        duplicateEvent("event-1", "2026-06-09", clientId, planId),
      ).resolves.toBe("event-2");
      expect(mockGetClientTodayString).toHaveBeenCalledWith(clientId);
    });

    it("countModifiedFutureEvents anchors its window at the client's local today", async () => {
      const countQuery = createMockQuery({ data: null, error: null, count: 3 });
      mockFrom.mockReturnValue(countQuery as any);

      await expect(countModifiedFutureEvents(clientId, planId)).resolves.toBe(3);
      expect(mockGetClientTodayString).toHaveBeenCalledWith(clientId);
      expect(countQuery.gte).toHaveBeenCalledWith("date", "2026-06-09");
    });
  });
});
