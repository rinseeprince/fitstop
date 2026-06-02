import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";

// Mock supabase-admin before importing the service under test.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock the training-event-service: we exercise getCheckInTrainingPeriodStats /
// getTrainingEventDetailsForPeriod, which call getEventsForDateRange and
// countEventsInRange — stub those so the only real query is the session_logs
// batch read (and the completed-events count) against the mocked supabaseAdmin.
vi.mock("./training-event-service", () => ({
  getEventsForDateRange: vi.fn(),
  countEventsInRange: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getEventsForDateRange, countEventsInRange } from "./training-event-service";
import {
  getCheckInTrainingPeriodStats,
  getTrainingEventDetailsForPeriod,
} from "./check-in-context-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetEvents = vi.mocked(getEventsForDateRange);
const mockCountEvents = vi.mocked(countEventsInRange);

const PERIOD_START = "2026-04-06";
const PERIOD_END = "2026-04-12";
const CLIENT = "client-1";

// Build a chained query whose terminal (.lte) resolves to `{ count }`. Used for
// the completed-events count head query in getCheckInTrainingPeriodStats.
function countQuery(count: number | null, error: { message: string } | null = null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte"]) q[m] = vi.fn(() => q);
  q.lte = vi.fn(() => Promise.resolve({ count, error }));
  return q;
}

// Build a chained query whose terminal (.in) resolves to `{ data }`. Used for
// the batched session_logs read in getTrainingEventDetailsForPeriod.
function logsQuery(
  data: Array<{
    id: string;
    notes: string | null;
    completion_quality: string;
    training_session_id: string | null;
  }> | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() => Promise.resolve({ data, error }));
  return q;
}

describe("check-in-context-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // getCheckInTrainingPeriodStats — counts training_events.status='completed'
  // =========================================================================
  describe("getCheckInTrainingPeriodStats", () => {
    it("counts only completed events and preserves { sessionsCompleted, sessionsPlanned }", async () => {
      mockFrom.mockReturnValue(countQuery(2) as never);
      mockCountEvents.mockResolvedValue(4);

      const result = await getCheckInTrainingPeriodStats(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual({ sessionsCompleted: 2, sessionsPlanned: 4 });
      // Queries training_events, filtered to status='completed' over the period.
      expect(mockFrom).toHaveBeenCalledWith("training_events");
      expect(mockCountEvents).toHaveBeenCalledWith(CLIENT, PERIOD_START, PERIOD_END);
    });

    it("returns zero completed when there are no completed events", async () => {
      mockFrom.mockReturnValue(countQuery(0) as never);
      mockCountEvents.mockResolvedValue(3);

      const result = await getCheckInTrainingPeriodStats(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual({ sessionsCompleted: 0, sessionsPlanned: 3 });
    });

    it("treats a null count as zero", async () => {
      mockFrom.mockReturnValue(countQuery(null) as never);
      mockCountEvents.mockResolvedValue(0);

      const result = await getCheckInTrainingPeriodStats(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual({ sessionsCompleted: 0, sessionsPlanned: 0 });
    });
  });

  // =========================================================================
  // getTrainingEventDetailsForPeriod — single-source per-event detail
  // =========================================================================
  describe("getTrainingEventDetailsForPeriod", () => {
    it("returns [] and does not query session_logs when there are no events", async () => {
      mockGetEvents.mockResolvedValue([]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual([]);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("emits status + name for a completed event with a linked log", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-1",
      });
      mockGetEvents.mockResolvedValue([ev]);
      mockFrom.mockReturnValue(
        logsQuery([
          { id: "log-1", notes: "felt strong", completion_quality: "full", training_session_id: "sess-1" },
        ]) as never,
      );

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual([
        {
          eventId: "ev-1",
          date: "2026-04-08",
          sessionName: "Push Day",
          status: "completed",
          logStatus: "logged",
          trainingSessionId: "sess-1",
          notes: "felt strong",
          completionQuality: "full",
        },
      ]);
    });

    it("includes notes + completionQuality='skipped' for an explicit skip", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-2",
        date: "2026-04-09",
        sessionName: "Leg Day",
        status: "skipped",
        sessionLogId: "log-2",
        trainingSessionId: "sess-2",
      });
      mockGetEvents.mockResolvedValue([ev]);
      mockFrom.mockReturnValue(
        logsQuery([
          { id: "log-2", notes: "sick", completion_quality: "skipped", training_session_id: "sess-2" },
        ]) as never,
      );

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result[0]).toMatchObject({
        eventId: "ev-2",
        status: "skipped",
        logStatus: "logged",
        notes: "sick",
        completionQuality: "skipped",
      });
    });

    it("marks an event with no session_log as not_logged with no notes/quality", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-3",
        date: "2026-04-10",
        sessionName: "Pull Day",
        status: "scheduled",
        sessionLogId: null,
        trainingSessionId: "sess-3",
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      // No log ids → no session_logs read at all.
      expect(mockFrom).not.toHaveBeenCalled();
      expect(result[0]).toEqual({
        eventId: "ev-3",
        date: "2026-04-10",
        sessionName: "Pull Day",
        status: "scheduled",
        logStatus: "not_logged",
        trainingSessionId: "sess-3",
      });
      expect(result[0]).not.toHaveProperty("notes");
      expect(result[0]).not.toHaveProperty("completionQuality");
    });

    it("returns details in date order, left-joining only the events that have logs", async () => {
      const evA = createMockTrainingEvent({
        id: "ev-a",
        date: "2026-04-06",
        sessionName: "A",
        status: "completed",
        sessionLogId: "log-a",
        trainingSessionId: "sess-a",
      });
      const evB = createMockTrainingEvent({
        id: "ev-b",
        date: "2026-04-08",
        sessionName: "B",
        status: "scheduled",
        sessionLogId: null,
        trainingSessionId: "sess-b",
      });
      const evC = createMockTrainingEvent({
        id: "ev-c",
        date: "2026-04-11",
        sessionName: "C",
        status: "partial",
        sessionLogId: "log-c",
        trainingSessionId: "sess-c",
      });
      // getEventsForDateRange already returns ordered-by-date events.
      mockGetEvents.mockResolvedValue([evA, evB, evC]);
      const logsQ = logsQuery([
        { id: "log-a", notes: null, completion_quality: "full", training_session_id: "sess-a" },
        { id: "log-c", notes: "tired", completion_quality: "partial", training_session_id: "sess-c" },
      ]);
      mockFrom.mockReturnValue(logsQ as never);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result.map((d) => d.eventId)).toEqual(["ev-a", "ev-b", "ev-c"]);
      // Only the two events with logs were batched in the IN clause.
      expect(logsQ.in).toHaveBeenCalledWith("id", ["log-a", "log-c"]);
      // Completed-with-log but null notes → completionQuality set, no notes key.
      expect(result[0]).toMatchObject({ logStatus: "logged", completionQuality: "full" });
      expect(result[0]).not.toHaveProperty("notes");
      // Unlogged middle event.
      expect(result[1]).toMatchObject({ logStatus: "not_logged", status: "scheduled" });
      // Partial-with-log.
      expect(result[2]).toMatchObject({ logStatus: "logged", completionQuality: "partial", notes: "tired" });
    });
  });
});
