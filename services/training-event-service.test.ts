import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockTrainingEventRow } from "@/__tests__/helpers/mock-data-builders";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Client-local today resolution: default to the server clock so the existing
// (timezone-agnostic) fixtures behave exactly as before.
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
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
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
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
import { getClientTodayString } from "./today-service";
import { getTodayDateString } from "@/lib/date-helpers";
import {
  generateTrainingEvents,
  getEventsForDateRange,
  getEventForDate,
  countEventsInRange,
  linkSessionLogToEvent,
  findMatchingEvent,
  getEventSummariesForDate,
} from "./training-event-service";
import type { SessionInput } from "./training-event-service";

vi.mocked(getClientTodayString).mockImplementation(() =>
  Promise.resolve(getTodayDateString()),
);

// Mock query for findMatchingEvent: a single chained read resolving to `rows`.
// Rows must be supplied in the query's sort order (date asc, created_at asc).
function matcherQuery(
  rows: Array<{
    id: string;
    training_session_id: string | null;
    date: string;
    created_at: string;
  }>,
) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "gte", "lte", "order"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return q;
}

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
        { id: "s1", name: "Push", dayOfWeek: "monday", focus: "chest", estimatedCalories: 400 },
        { id: "s2", name: "Pull", dayOfWeek: "wednesday", focus: "back", estimatedCalories: 350 },
        { id: "s3", name: "Legs", dayOfWeek: "friday", focus: "legs", estimatedCalories: 500 },
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
        { id: "s1", name: "Push", dayOfWeek: "monday" },
        { id: "s2", name: "Unassigned" }, // No dayOfWeek
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
        { id: "s1", name: "AM Cardio", dayOfWeek: "monday", estimatedCalories: 200 },
        { id: "s2", name: "PM Weights", dayOfWeek: "monday", estimatedCalories: 400 },
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
        { id: "s1", name: "Unassigned" },
      ];

      await generateTrainingEvents("client-1", "plan-1", sessions, "2026-04-06", "2026-04-12");

      expect(mockQuery.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // =========================================================================

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

  // =========================================================================
  // findMatchingEvent (Session 5.3 matcher)
  // =========================================================================
  describe("findMatchingEvent", () => {
    const args = {
      clientId: "c1",
      performedSessionId: "pull",
      completedAt: "2026-05-08",
      weekStart: "2026-05-04",
      weekEnd: "2026-05-10",
    };

    it("[m1] prefers an unlinked same-session event, earliest date in week", async () => {
      mockFrom.mockReturnValue(
        matcherQuery([
          { id: "ev-tue", training_session_id: "pull", date: "2026-05-05", created_at: "t1" },
          { id: "ev-wed", training_session_id: "push", date: "2026-05-06", created_at: "t2" },
          { id: "ev-thu", training_session_id: "pull", date: "2026-05-07", created_at: "t3" },
        ]) as never,
      );
      const match = await findMatchingEvent(args);
      expect(match?.id).toBe("ev-tue");
    });

    it("[m2] falls back to a same-date event (any session) when no same-session match", async () => {
      mockFrom.mockReturnValue(
        matcherQuery([
          { id: "ev-legs", training_session_id: "legs", date: "2026-05-08", created_at: "t1" },
        ]) as never,
      );
      const match = await findMatchingEvent(args);
      expect(match?.id).toBe("ev-legs");
    });

    it("[m3] matches a same-session event on a different day when there's no same-date event", async () => {
      mockFrom.mockReturnValue(
        matcherQuery([
          { id: "ev-mon", training_session_id: "pull", date: "2026-05-04", created_at: "t1" },
        ]) as never,
      );
      const match = await findMatchingEvent(args);
      expect(match?.id).toBe("ev-mon");
    });

    it("[m4] returns null when there is no candidate", async () => {
      mockFrom.mockReturnValue(matcherQuery([]) as never);
      const match = await findMatchingEvent(args);
      expect(match).toBeNull();
    });
  });

  // =========================================================================
  // getEventSummariesForDate — performed-session display for swaps
  // =========================================================================
  describe("getEventSummariesForDate", () => {
    function routeByTable(byTable: Record<string, ReturnType<typeof createMockQuery>>) {
      mockFrom.mockImplementation(((table: string) => byTable[table]) as never);
    }

    it("shows the PERFORMED session name + its exercise count for a swap", async () => {
      // Prescribed "Chest Day" (chest), but the linked log was performed as "Back Day" (back).
      const eventRow = createMockTrainingEventRow({
        id: "ev-1",
        trainingSessionId: "chest",
        sessionName: "Chest Day",
        date: "2026-05-08",
        status: "completed",
        sessionLogId: "log-1",
      });
      routeByTable({
        training_events: createMockQuery({ data: [eventRow], error: null }),
        exercise_logs: createMockQuery({
          data: [{ session_log_id: "log-1" }, { session_log_id: "log-1" }],
          error: null,
        }),
        session_logs: createMockQuery({
          data: [{ id: "log-1", training_session_id: "back" }],
          error: null,
        }),
        training_exercises: createMockQuery({
          data: [{ session_id: "back" }, { session_id: "back" }],
          error: null,
        }),
        training_sessions: createMockQuery({
          data: [{ id: "back", name: "Back Day" }],
          error: null,
        }),
      });

      const result = await getEventSummariesForDate("c1", "2026-05-08");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionName: "Back Day", // performed, not the prescribed "Chest Day"
        isAlternative: true,
        loggedExerciseCount: 2,
        prescribedExerciseCount: 2, // against Back's prescription, not Chest's
      });
    });

    it("is not alternative and keeps the prescribed name when no swap", async () => {
      const eventRow = createMockTrainingEventRow({
        id: "ev-1",
        trainingSessionId: "chest",
        sessionName: "Chest Day",
        date: "2026-05-08",
        status: "completed",
        sessionLogId: "log-1",
      });
      routeByTable({
        training_events: createMockQuery({ data: [eventRow], error: null }),
        exercise_logs: createMockQuery({ data: [{ session_log_id: "log-1" }], error: null }),
        session_logs: createMockQuery({
          data: [{ id: "log-1", training_session_id: "chest" }], // same as prescribed
          error: null,
        }),
        training_exercises: createMockQuery({ data: [{ session_id: "chest" }], error: null }),
        training_sessions: createMockQuery({
          data: [{ id: "chest", name: "Chest Day" }],
          error: null,
        }),
      });

      const result = await getEventSummariesForDate("c1", "2026-05-08");

      expect(result[0].isAlternative).toBe(false);
      expect(result[0].sessionName).toBe("Chest Day");
    });
  });
});
