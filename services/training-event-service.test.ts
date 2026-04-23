import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockTrainingEventRow } from "@/__tests__/helpers/mock-data-builders";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Inline query mock helper (avoids importing mock-supabase which has hoisting issues)
function createMockQuery<T = unknown>(result: { data: T | null; error: { message: string } | null }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
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
import {
  generateTrainingEvents,
  regenerateFutureEvents,
  deleteFutureEventsForPlan,
  getEventsForDateRange,
  getEventForDate,
  countEventsInRange,
  linkSessionLogToEvent,
} from "./training-event-service";
import type { SessionInput } from "./training-event-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

describe("training-event-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // generateTrainingEvents
  // =========================================================================

  describe("generateTrainingEvents", () => {
    it("generates correct events for a 3-day weekly schedule over 2 weeks", async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const sessions: SessionInput[] = [
        { id: "s1", name: "Push", dayOfWeek: "monday", sessionType: "training", focus: "chest", estimatedCalories: 400 },
        { id: "s2", name: "Pull", dayOfWeek: "wednesday", sessionType: "training", focus: "back", estimatedCalories: 350 },
        { id: "s3", name: "Legs", dayOfWeek: "friday", sessionType: "training", focus: "legs", estimatedCalories: 500 },
      ];

      await generateTrainingEvents("client-1", "plan-1", sessions, "2026-04-06", "2026-04-19");

      expect(mockFrom).toHaveBeenCalledWith("training_events");
      expect(mockQuery.upsert).toHaveBeenCalledTimes(1);

      const upsertCall = mockQuery.upsert.mock.calls[0];
      const rows = upsertCall[0];

      // 2 weeks × 3 sessions = 6 events
      expect(rows).toHaveLength(6);

      // Verify first week
      expect(rows[0]).toMatchObject({ client_id: "client-1", training_session_id: "s1", date: "2026-04-06", session_name: "Push" });
      expect(rows[1]).toMatchObject({ training_session_id: "s2", date: "2026-04-08", session_name: "Pull" });
      expect(rows[2]).toMatchObject({ training_session_id: "s3", date: "2026-04-10", session_name: "Legs" });

      // Verify second week
      expect(rows[3]).toMatchObject({ training_session_id: "s1", date: "2026-04-13" });
      expect(rows[4]).toMatchObject({ training_session_id: "s2", date: "2026-04-15" });
      expect(rows[5]).toMatchObject({ training_session_id: "s3", date: "2026-04-17" });

      // All should have status: scheduled
      expect(rows.every((r: any) => r.status === "scheduled")).toBe(true);

      // Verify upsert options
      expect(upsertCall[1]).toEqual({
        onConflict: "client_id,training_session_id,date",
        ignoreDuplicates: true,
      });
    });

    it("filters out sessions without dayOfWeek", async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const sessions: SessionInput[] = [
        { id: "s1", name: "Push", dayOfWeek: "monday", sessionType: "training" },
        { id: "s2", name: "Unassigned", sessionType: "training" }, // No dayOfWeek
      ];

      await generateTrainingEvents("client-1", "plan-1", sessions, "2026-04-06", "2026-04-12");

      const rows = mockQuery.upsert.mock.calls[0][0];
      expect(rows).toHaveLength(1);
      expect(rows[0].session_name).toBe("Push");
    });

    it("generates events for multiple sessions on the same day", async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const sessions: SessionInput[] = [
        { id: "s1", name: "AM Cardio", dayOfWeek: "monday", sessionType: "training", estimatedCalories: 200 },
        { id: "s2", name: "PM Weights", dayOfWeek: "monday", sessionType: "training", estimatedCalories: 400 },
      ];

      await generateTrainingEvents("client-1", "plan-1", sessions, "2026-04-06", "2026-04-06");

      const rows = mockQuery.upsert.mock.calls[0][0];
      expect(rows).toHaveLength(2);
      expect(rows[0].session_name).toBe("AM Cardio");
      expect(rows[1].session_name).toBe("PM Weights");
    });

    it("does not call upsert when no sessions have dayOfWeek", async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const sessions: SessionInput[] = [
        { id: "s1", name: "Unassigned", sessionType: "training" },
      ];

      await generateTrainingEvents("client-1", "plan-1", sessions, "2026-04-06", "2026-04-12");

      expect(mockQuery.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // regenerateFutureEvents
  // =========================================================================

  describe("regenerateFutureEvents", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-08T12:00:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("deletes future scheduled events and regenerates from active sessions with phase end_date", async () => {
      const callIndex: string[] = [];

      // Mock delete query (training_events)
      const deleteQuery = createMockQuery({ data: null, error: null });

      // Mock select sessions query (training_sessions)
      const sessionsQuery = createMockQuery({
        data: [
          { id: "s1", name: "Push", day_of_week: "monday", session_type: "training", focus: "chest", estimated_calories: 400 },
          { id: "s2", name: "Pull", day_of_week: "wednesday", session_type: "training", focus: "back", estimated_calories: 350 },
        ],
        error: null,
      });

      // Mock select plan query (training_plans)
      const planQuery = createMockQuery({
        data: { effective_from: "2026-04-01", program_duration_weeks: null, phase_id: "phase-1" },
        error: null,
      });

      // Mock select phase query (phases)
      const phaseQuery = createMockQuery({
        data: { end_date: "2026-05-15", start_date: "2026-04-01", duration_weeks: null },
        error: null,
      });

      // Mock upsert query (training_events)
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        callIndex.push(table);
        const count = callIndex.filter((t) => t === table).length;

        if (table === "training_events") {
          // First call is delete, second is upsert
          return count === 1 ? (deleteQuery as any) : (upsertQuery as any);
        }
        if (table === "training_sessions") return sessionsQuery as any;
        if (table === "training_plans") return planQuery as any;
        if (table === "phases") return phaseQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureEvents("client-1", "plan-1");

      // Verify delete was called
      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(deleteQuery.eq).toHaveBeenCalledWith("training_plan_id", "plan-1");
      expect(deleteQuery.gte).toHaveBeenCalledWith("date", "2026-04-08");
      expect(deleteQuery.eq).toHaveBeenCalledWith("status", "scheduled");

      // Verify sessions were fetched
      expect(sessionsQuery.eq).toHaveBeenCalledWith("plan_id", "plan-1");
      expect(sessionsQuery.eq).toHaveBeenCalledWith("is_active", true);

      // Verify phase was queried
      expect(phaseQuery.eq).toHaveBeenCalledWith("id", "phase-1");

      // Verify upsert was called with events
      expect(upsertQuery.upsert).toHaveBeenCalled();
    });

    it("uses start_date + duration_weeks when phase has no end_date", async () => {
      const callIndex: string[] = [];

      const deleteQuery = createMockQuery({ data: null, error: null });
      const sessionsQuery = createMockQuery({
        data: [
          { id: "s1", name: "Push", day_of_week: "monday", session_type: "training", focus: null, estimated_calories: null },
        ],
        error: null,
      });
      const planQuery = createMockQuery({
        data: { effective_from: "2026-04-01", program_duration_weeks: null, phase_id: "phase-1" },
        error: null,
      });
      const phaseQuery = createMockQuery({
        data: { end_date: null, start_date: "2026-04-01", duration_weeks: 6 },
        error: null,
      });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        callIndex.push(table);
        const count = callIndex.filter((t) => t === table).length;
        if (table === "training_events") return count === 1 ? (deleteQuery as any) : (upsertQuery as any);
        if (table === "training_sessions") return sessionsQuery as any;
        if (table === "training_plans") return planQuery as any;
        if (table === "phases") return phaseQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureEvents("client-1", "plan-1");

      // Phase start 2026-04-01 + 6 weeks = 2026-05-13
      // Events from 2026-04-08 (today) to 2026-05-13
      // That's ~5 weeks of Mondays: 4/13, 4/20, 4/27, 5/4, 5/11 = 5 events
      expect(upsertQuery.upsert).toHaveBeenCalled();
      const rows = upsertQuery.upsert.mock.calls[0][0];
      expect(rows.length).toBeGreaterThan(0);
      // All dates should be >= today
      expect(rows.every((r: any) => r.date >= "2026-04-08")).toBe(true);
    });

    it("falls back to 8 weeks when phase has start_date but no end_date or duration_weeks", async () => {
      const callIndex: string[] = [];

      const deleteQuery = createMockQuery({ data: null, error: null });
      const sessionsQuery = createMockQuery({
        data: [
          { id: "s1", name: "Push", day_of_week: "monday", session_type: "training", focus: null, estimated_calories: null },
        ],
        error: null,
      });
      const planQuery = createMockQuery({
        data: { effective_from: "2026-04-01", program_duration_weeks: null, phase_id: "phase-1" },
        error: null,
      });
      const phaseQuery = createMockQuery({
        data: { end_date: null, start_date: "2026-04-01", duration_weeks: null },
        error: null,
      });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        callIndex.push(table);
        const count = callIndex.filter((t) => t === table).length;
        if (table === "training_events") return count === 1 ? (deleteQuery as any) : (upsertQuery as any);
        if (table === "training_sessions") return sessionsQuery as any;
        if (table === "training_plans") return planQuery as any;
        if (table === "phases") return phaseQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureEvents("client-1", "plan-1");

      // Should fall back to 8 weeks from today (2026-04-08 + 56 days = 2026-06-03)
      expect(upsertQuery.upsert).toHaveBeenCalled();
      const rows = upsertQuery.upsert.mock.calls[0][0];
      // 8 weeks of Mondays from 2026-04-08: 4/13, 4/20, 4/27, 5/4, 5/11, 5/18, 5/25, 6/1 = 8 events
      expect(rows).toHaveLength(8);
    });

    it("falls back to 8 weeks when no phase and no program_duration_weeks", async () => {
      const callIndex: string[] = [];

      const deleteQuery = createMockQuery({ data: null, error: null });
      const sessionsQuery = createMockQuery({
        data: [
          { id: "s1", name: "Push", day_of_week: "monday", session_type: "training", focus: null, estimated_calories: null },
        ],
        error: null,
      });
      const planQuery = createMockQuery({
        data: { effective_from: "2026-04-01", program_duration_weeks: null, phase_id: null },
        error: null,
      });
      const upsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        callIndex.push(table);
        const count = callIndex.filter((t) => t === table).length;
        if (table === "training_events") return count === 1 ? (deleteQuery as any) : (upsertQuery as any);
        if (table === "training_sessions") return sessionsQuery as any;
        if (table === "training_plans") return planQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureEvents("client-1", "plan-1");

      expect(upsertQuery.upsert).toHaveBeenCalled();
      const rows = upsertQuery.upsert.mock.calls[0][0];
      expect(rows).toHaveLength(8); // 8 weeks of Mondays
    });

    it("generates zero events when phase end_date is in the past", async () => {
      const callIndex: string[] = [];

      const deleteQuery = createMockQuery({ data: null, error: null });
      const sessionsQuery = createMockQuery({
        data: [
          { id: "s1", name: "Push", day_of_week: "monday", session_type: "training", focus: null, estimated_calories: null },
        ],
        error: null,
      });
      const planQuery = createMockQuery({
        data: { effective_from: "2026-01-01", program_duration_weeks: null, phase_id: "phase-1" },
        error: null,
      });
      const phaseQuery = createMockQuery({
        data: { end_date: "2026-03-01", start_date: "2026-01-01", duration_weeks: null },
        error: null,
      });

      mockFrom.mockImplementation((table: string) => {
        callIndex.push(table);
        const count = callIndex.filter((t) => t === table).length;
        if (table === "training_events") return deleteQuery as any;
        if (table === "training_sessions") return sessionsQuery as any;
        if (table === "training_plans") return planQuery as any;
        if (table === "phases") return phaseQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureEvents("client-1", "plan-1");

      // Delete was called but upsert should not have been called
      expect(deleteQuery.delete).toHaveBeenCalled();
      // No upsert call since endDate (2026-03-01) < today (2026-04-08)
      // The training_events from() was only called once (for delete)
      const trainingEventCalls = callIndex.filter((t) => t === "training_events");
      expect(trainingEventCalls).toHaveLength(1);
    });

    it("does not delete completed or partial events", async () => {
      const callIndex: string[] = [];
      const deleteQuery = createMockQuery({ data: null, error: null });
      const sessionsQuery = createMockQuery({ data: [], error: null });
      const planQuery = createMockQuery({
        data: { effective_from: "2026-04-01", program_duration_weeks: null, phase_id: null },
        error: null,
      });

      mockFrom.mockImplementation((table: string) => {
        callIndex.push(table);
        if (table === "training_events") return deleteQuery as any;
        if (table === "training_sessions") return sessionsQuery as any;
        if (table === "training_plans") return planQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await regenerateFutureEvents("client-1", "plan-1");

      // The delete filter includes .eq("status", "scheduled") — only scheduled events
      expect(deleteQuery.eq).toHaveBeenCalledWith("status", "scheduled");
    });
  });

  // =========================================================================
  // getEventsForDateRange
  // =========================================================================

  describe("getEventsForDateRange", () => {
    it("returns mapped TrainingEvent[] sorted by date", async () => {
      const row1 = createMockTrainingEventRow({ date: "2026-04-06", sessionName: "Push" });
      const row2 = createMockTrainingEventRow({ date: "2026-04-08", sessionName: "Pull" });
      const mockQuery = createMockQuery({ data: [row1, row2], error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await getEventsForDateRange("client-1", "2026-04-06", "2026-04-12");

      expect(result).toHaveLength(2);
      expect(result[0].sessionName).toBe("Push");
      expect(result[0].date).toBe("2026-04-06");
      expect(result[1].sessionName).toBe("Pull");
      // Verify camelCase mapping
      expect(result[0].clientId).toBe(row1.client_id);
      expect(result[0].trainingPlanId).toBe(row1.training_plan_id);

      expect(mockQuery.order).toHaveBeenCalledWith("date", { ascending: true });
    });
  });

  // =========================================================================
  // getEventForDate
  // =========================================================================

  describe("getEventForDate", () => {
    it("returns null when no event exists", async () => {
      const mockQuery = createMockQuery({ data: null, error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await getEventForDate("client-1", "2026-04-08");

      expect(result).toBeNull();
      expect(mockQuery.maybeSingle).toHaveBeenCalled();
    });

    it("returns mapped event when found", async () => {
      const row = createMockTrainingEventRow({ date: "2026-04-08", sessionName: "Push" });
      const mockQuery = createMockQuery({ data: row, error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await getEventForDate("client-1", "2026-04-08");

      expect(result).not.toBeNull();
      expect(result!.sessionName).toBe("Push");
      expect(result!.date).toBe("2026-04-08");
    });
  });

  // =========================================================================
  // countEventsInRange
  // =========================================================================

  describe("countEventsInRange", () => {
    it("returns correct count", async () => {
      const mockQuery = createMockQuery({ data: null, error: null });
      // Override to add count property
      Object.defineProperty(mockQuery, "then", {
        value: (resolve: (v: any) => void) =>
          Promise.resolve({ count: 5, data: null, error: null }).then(resolve),
      });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await countEventsInRange("client-1", "2026-04-06", "2026-04-12");

      expect(result).toBe(5);
      expect(mockQuery.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
    });
  });

  // =========================================================================
  // linkSessionLogToEvent
  // =========================================================================

  describe("linkSessionLogToEvent", () => {
    it("updates session_log_id and status", async () => {
      const mockQuery = createMockQuery({ data: null, error: null });
      mockFrom.mockReturnValue(mockQuery as any);

      await linkSessionLogToEvent("event-1", "log-1", "completed");

      expect(mockFrom).toHaveBeenCalledWith("training_events");
      expect(mockQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          session_log_id: "log-1",
          status: "completed",
        })
      );
      expect(mockQuery.eq).toHaveBeenCalledWith("id", "event-1");
    });
  });
});
