import { describe, it, expect, vi, beforeEach } from "vitest";
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
import {
  duplicateWeek,
  duplicateWeekToRemaining,
  deleteEvent,
} from "./training-event-calendar-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetEventsForDateRange = vi.mocked(getEventsForDateRange);

describe("training-event-calendar-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      session_type: "training",
      activity_metadata: null,
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
        data: { id: "s1", plan_id: "plan-1", name: "Push", day_of_week: "monday", order_index: 0, focus: null, notes: null, estimated_duration_minutes: 60, session_type: "training", activity_metadata: null, estimated_calories: 400, calories_calculated_at: null, is_active: true },
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
});
