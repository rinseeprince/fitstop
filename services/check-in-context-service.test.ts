import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";

// Mock supabase-admin before importing the service under test.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock the training-event-service: we exercise getTrainingEventDetailsForPeriod,
// which calls getEventsForDateRange — the events arrive with their logs already
// embedded, so the only query left in the function is the performed-session
// name lookup on a swap.
vi.mock("./training-event-service", () => ({
  getEventsForDateRange: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getEventsForDateRange } from "./training-event-service";
import {
  getExerciseSummariesForPeriod,
  getTrainingEventDetailsForPeriod,
} from "./check-in-context-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetEvents = vi.mocked(getEventsForDateRange);

/** The log a calendar read embeds on a workout. */
const log = (overrides: {
  id?: string;
  completionQuality?: "full" | "partial" | "skipped";
  performedSessionId?: string | null;
  notes?: string | null;
}) => ({
  id: overrides.id ?? "log-1",
  completionQuality: overrides.completionQuality ?? "full",
  performedSessionId:
    overrides.performedSessionId === undefined ? null : overrides.performedSessionId,
  notes: overrides.notes ?? null,
});

const PERIOD_START = "2026-04-06";
const PERIOD_END = "2026-04-12";
const CLIENT = "client-1";

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
  // getTrainingEventDetailsForPeriod — single-source per-workout detail
  // =========================================================================
  describe("getTrainingEventDetailsForPeriod", () => {
    it("returns [] and queries nothing else when there are no events", async () => {
      mockGetEvents.mockResolvedValue([]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result).toEqual([]);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("emits status + name + the log's quality for a logged workout", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-1",
        log: log({ performedSessionId: "sess-1", notes: "felt strong" }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      // The quality rides the events read — no second query for the logs.
      expect(mockFrom).not.toHaveBeenCalled();
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
        log: log({
          id: "log-2",
          completionQuality: "skipped",
          performedSessionId: "sess-2",
          notes: "sick",
        }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result[0]).toMatchObject({
        eventId: "ev-2",
        status: "skipped",
        logStatus: "logged",
        notes: "sick",
        completionQuality: "skipped",
      });
    });

    it("marks a workout with no log as not_logged, with a null quality and no notes", async () => {
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

      expect(mockFrom).not.toHaveBeenCalled();
      expect(result[0]).toEqual({
        eventId: "ev-3",
        date: "2026-04-10",
        sessionName: "Pull Day",
        status: "scheduled",
        logStatus: "not_logged",
        trainingSessionId: "sess-3",
        sessionLogId: null,
        // Always present, so the row itself is a workout read.
        completionQuality: null,
      });
      expect(result[0]).not.toHaveProperty("notes");
    });

    it("returns details in calendar order, each carrying its own log's quality", async () => {
      const evA = createMockTrainingEvent({
        id: "ev-a",
        date: "2026-04-06",
        sessionName: "A",
        status: "completed",
        sessionLogId: "log-a",
        trainingSessionId: "sess-a",
        log: log({ id: "log-a", performedSessionId: "sess-a" }),
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
        log: log({
          id: "log-c",
          completionQuality: "partial",
          performedSessionId: "sess-c",
          notes: "tired",
        }),
      });
      // getEventsForDateRange already returns ordered-by-date events.
      mockGetEvents.mockResolvedValue([evA, evB, evC]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result.map((d) => d.eventId)).toEqual(["ev-a", "ev-b", "ev-c"]);
      // Logged with null notes → quality set, no notes key.
      expect(result[0]).toMatchObject({ logStatus: "logged", completionQuality: "full" });
      expect(result[0]).not.toHaveProperty("notes");
      // Unlogged middle workout.
      expect(result[1]).toMatchObject({
        logStatus: "not_logged",
        status: "scheduled",
        completionQuality: null,
      });
      // Partial-with-log.
      expect(result[2]).toMatchObject({
        logStatus: "logged",
        completionQuality: "partial",
        notes: "tired",
      });
    });

    it("resolves performedSessionName on a swap (performed session ≠ prescribed)", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-1",
        date: "2026-04-08",
        sessionName: "Push Day",
        status: "completed",
        sessionLogId: "log-1",
        trainingSessionId: "sess-prescribed",
        log: log({ performedSessionId: "sess-performed" }),
      });
      mockGetEvents.mockResolvedValue([ev]);
      mockFrom.mockReturnValue(
        sessionNamesQuery([{ id: "sess-performed", name: "Pull Day" }]) as never,
      );

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledWith("training_sessions");
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
        log: log({ performedSessionId: "sess-1" }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(mockFrom).not.toHaveBeenCalled();
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
