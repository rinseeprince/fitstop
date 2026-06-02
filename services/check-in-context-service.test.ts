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
  getExerciseSummariesForPeriod,
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

// Build a chained query whose terminal (.in) resolves to `{ data }`. Used for
// the batched training_sessions name read on a swap.
function sessionNamesQuery(
  data: Array<{ id: string; name: string }> | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() => Promise.resolve({ data, error }));
  return q;
}

// exercise_logs read (.select(...).in(...)).
function exerciseLogsQuery(
  data: Array<{
    id: string;
    session_log_id: string;
    performed_name: string | null;
    prescribed_exercise_snapshot: { name?: string } | null;
  }> | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() => Promise.resolve({ data, error }));
  return q;
}

// set_logs read (.select('*').in(...).order(...)).
function setLogsQuery(
  data: Array<{
    exercise_log_id: string;
    reps: number | null;
    weight: number | null;
    rpe: number | null;
  }> | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() => q);
  q.order = vi.fn(() => Promise.resolve({ data, error }));
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
          sessionLogId: "log-1",
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
        sessionLogId: null,
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

    it("resolves performedSessionName on a swap (performed session ≠ prescribed)", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-prescribed",
      });
      mockGetEvents.mockResolvedValue([ev]);
      // First .from → session_logs (performed session = sess-performed, a swap).
      // Second .from → training_sessions name lookup for the performed session.
      mockFrom
        .mockReturnValueOnce(
          logsQuery([
            { id: "log-1", notes: null, completion_quality: "full", training_session_id: "sess-performed" },
          ]) as never,
        )
        .mockReturnValueOnce(
          sessionNamesQuery([{ id: "sess-performed", name: "Pull Day" }]) as never,
        );

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(mockFrom).toHaveBeenNthCalledWith(1, "session_logs");
      expect(mockFrom).toHaveBeenNthCalledWith(2, "training_sessions");
      expect(result[0]).toMatchObject({
        sessionLogId: "log-1",
        trainingSessionId: "sess-prescribed",
        performedSessionName: "Pull Day",
      });
    });

    it("does not look up a name (or set performedSessionName) when performed === prescribed", async () => {
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
          { id: "log-1", notes: null, completion_quality: "full", training_session_id: "sess-1" },
        ]) as never,
      );

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      // Only the session_logs read — no training_sessions name lookup.
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledWith("session_logs");
      expect(result[0]).not.toHaveProperty("performedSessionName");
    });
  });

  // =========================================================================
  // getExerciseSummariesForPeriod — per-session top-set lines (Session 6.3)
  // =========================================================================
  describe("getExerciseSummariesForPeriod", () => {
    it("returns an empty Map for empty input without querying", async () => {
      const result = await getExerciseSummariesForPeriod([]);
      expect(result.size).toBe(0);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("picks the heaviest set as the top set and counts all sets", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            {
              id: "ex-1",
              session_log_id: "log-1",
              performed_name: "Bench Press",
              prescribed_exercise_snapshot: null,
            },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            { exercise_log_id: "ex-1", reps: 8, weight: 80, rpe: 7 },
            { exercise_log_id: "ex-1", reps: 5, weight: 100, rpe: 9 },
            { exercise_log_id: "ex-1", reps: 6, weight: 90, rpe: 8 },
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"]);

      expect(result.get("log-1")).toEqual(["Bench Press — 3 sets, top 100x5 @ RPE 9"]);
    });

    it("omits ' @ RPE' when the top set's rpe is null", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            {
              id: "ex-1",
              session_log_id: "log-1",
              performed_name: null,
              prescribed_exercise_snapshot: { name: "Squat" },
            },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            { exercise_log_id: "ex-1", reps: 5, weight: 140, rpe: null },
            { exercise_log_id: "ex-1", reps: 5, weight: 120, rpe: 8 },
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"]);

      // Top set is the heaviest (140, rpe null) — no RPE suffix.
      expect(result.get("log-1")).toEqual(["Squat — 2 sets, top 140x5"]);
    });

    it("breaks a weight tie by higher reps", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            {
              id: "ex-1",
              session_log_id: "log-1",
              performed_name: "Row",
              prescribed_exercise_snapshot: null,
            },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            { exercise_log_id: "ex-1", reps: 6, weight: 80, rpe: 7 },
            { exercise_log_id: "ex-1", reps: 10, weight: 80, rpe: 8 },
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"]);

      expect(result.get("log-1")).toEqual(["Row — 2 sets, top 80x10 @ RPE 8"]);
    });

    it("groups multiple exercises under their session_log_id", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-1", session_log_id: "log-1", performed_name: "Bench", prescribed_exercise_snapshot: null },
            { id: "ex-2", session_log_id: "log-1", performed_name: "OHP", prescribed_exercise_snapshot: null },
            { id: "ex-3", session_log_id: "log-2", performed_name: "Squat", prescribed_exercise_snapshot: null },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            { exercise_log_id: "ex-1", reps: 5, weight: 100, rpe: 8 },
            { exercise_log_id: "ex-2", reps: 6, weight: 60, rpe: null },
            { exercise_log_id: "ex-3", reps: 5, weight: 140, rpe: 9 },
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1", "log-2"]);

      expect(result.get("log-1")).toEqual([
        "Bench — 1 sets, top 100x5 @ RPE 8",
        "OHP — 1 sets, top 60x6",
      ]);
      expect(result.get("log-2")).toEqual(["Squat — 1 sets, top 140x5 @ RPE 9"]);
    });

    it("falls back to 'Unknown exercise' when both name sources are absent", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-1", session_log_id: "log-1", performed_name: null, prescribed_exercise_snapshot: null },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([{ exercise_log_id: "ex-1", reps: 5, weight: 50, rpe: null }]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"]);

      expect(result.get("log-1")).toEqual(["Unknown exercise — 1 sets, top 50x5"]);
    });

    it("caps at 8 lines per session and appends '…and N more'", async () => {
      const exLogs = Array.from({ length: 11 }, (_, i) => ({
        id: `ex-${i}`,
        session_log_id: "log-1",
        performed_name: `Exercise ${i}`,
        prescribed_exercise_snapshot: null,
      }));
      const setLogs = exLogs.map((ex) => ({
        exercise_log_id: ex.id,
        reps: 5,
        weight: 50,
        rpe: null,
      }));
      mockFrom
        .mockReturnValueOnce(exerciseLogsQuery(exLogs) as never)
        .mockReturnValueOnce(setLogsQuery(setLogs) as never);

      const result = await getExerciseSummariesForPeriod(["log-1"]);
      const lines = result.get("log-1")!;

      // 8 kept lines + the overflow marker = 9 total.
      expect(lines).toHaveLength(9);
      expect(lines[0]).toBe("Exercise 0 — 1 sets, top 50x5");
      expect(lines[7]).toBe("Exercise 7 — 1 sets, top 50x5");
      expect(lines[8]).toBe("…and 3 more");
    });

    it("returns an empty Map (non-blocking) when the exercise_logs read errors", async () => {
      mockFrom.mockReturnValueOnce(
        exerciseLogsQuery(null, { message: "boom" }) as never,
      );

      const result = await getExerciseSummariesForPeriod(["log-1"]);

      expect(result.size).toBe(0);
    });
  });
});
