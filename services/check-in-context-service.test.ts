import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockTrainingEvent } from "@/__tests__/helpers/mock-data-builders";
import type { LoggedQuality } from "@/types/training";

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
  completionQuality?: LoggedQuality;
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

// exercise_logs read (.select(...).in(...)). An exercise with no
// training_exercise_id was logged outside the plan.
function exerciseLogsQuery(
  data: Array<{
    id: string;
    session_log_id: string;
    training_exercise_id?: string | null;
    performed_name: string | null;
    prescribed_exercise_snapshot: Record<string, unknown> | null;
  }> | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() =>
    Promise.resolve({
      data: data?.map((row) => ({ training_exercise_id: null, ...row })) ?? null,
      error,
    }),
  );
  return q;
}

/** A set_logs row: its identity, and every actual null but the ones given. */
function setRow(
  exerciseLogId: string,
  setNumber: number,
  actuals: Partial<Record<string, number | string | null>> = {},
) {
  return {
    id: `${exerciseLogId}-${setNumber}`,
    exercise_log_id: exerciseLogId,
    set_number: setNumber,
    set_type: "working",
    reps: null, weight: null, rpe: null, rir: null, tempo: null,
    distance_meters: null, duration_seconds: null, pace_seconds_per_km: null,
    split_seconds_per_500m: null, calories: null, cadence: null, stroke_rate: null,
    resistance: null, heart_rate_zone: null, heart_rate: null, power: null,
    ftp_percent: null, rest_seconds: null,
    created_at: "2026-04-08T10:00:00Z",
    updated_at: "2026-04-08T10:00:00Z",
    ...actuals,
  };
}

// set_logs read (.select('*').in(...).order(...)).
function setLogsQuery(
  data: ReturnType<typeof setRow>[] | null,
  error: { message: string } | null = null,
) {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.in = vi.fn(() => q);
  q.order = vi.fn(() => Promise.resolve({ data, error }));
  return q;
}

/** A prescription as logged: working sets of reps, a kilogram load range and an RPE. */
function strengthSnapshot(name: string, sets: number) {
  return {
    name,
    prescribed_fields: ["set_type", "load", "reps", "rpe", "rest"],
    set_specs: Array.from({ length: sets }, (_, i) => ({
      set_number: i + 1,
      set_type: "working",
      reps_min: 5,
      reps_max: 5,
      load_type: "absolute",
      load_min: 100,
      load_max: 105,
      rpe_min: 8,
      rpe_max: 8,
    })),
  };
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

    it("carries the notes and the PARTIAL quality of a workout partly done", async () => {
      const ev = createMockTrainingEvent({
        id: "ev-2",
        date: "2026-04-09",
        sessionName: "Leg Day",
        status: "completed",
        sessionLogId: "log-2",
        trainingSessionId: "sess-2",
        log: log({
          id: "log-2",
          completionQuality: "partial",
          performedSessionId: "sess-2",
          notes: "knee sore, cut it short",
        }),
      });
      mockGetEvents.mockResolvedValue([ev]);

      const result = await getTrainingEventDetailsForPeriod(CLIENT, PERIOD_START, PERIOD_END);

      expect(result[0]).toMatchObject({
        eventId: "ev-2",
        status: "completed",
        logStatus: "logged",
        notes: "knee sore, cut it short",
        completionQuality: "partial",
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
        status: "completed",
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
  // getExerciseSummariesForPeriod — the prescription beside the result, per
  // logged exercise, in the coach's units
  // =========================================================================
  describe("getExerciseSummariesForPeriod", () => {
    it("returns an empty Map for empty input without querying", async () => {
      const result = await getExerciseSummariesForPeriod([], "metric");
      expect(result.size).toBe(0);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("writes one line per logged exercise, measure by measure, naming what fell outside its target", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            {
              id: "ex-1",
              session_log_id: "log-1",
              training_exercise_id: "te-1",
              performed_name: null,
              prescribed_exercise_snapshot: strengthSnapshot("Back Squat", 3),
            },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            setRow("ex-1", 1, { reps: 5, weight: 102.5, rpe: 8 }),
            setRow("ex-1", 2, { reps: 5, weight: 102.5, rpe: 9 }),
            setRow("ex-1", 3, { reps: 4, weight: 102.5, rpe: 10 }),
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(result.get("log-1")).toEqual([
        "Back Squat — 3 of 3 working sets: " +
          "Load (kg) 102.5, 102.5, 102.5 (target 100–105 kg); " +
          "Reps 5, 5, 4 (target 5; 1 of 3 below target); " +
          "RPE 8, 9, 10 (target 8; 2 of 3 above target)",
      ]);
    });

    it("writes the line in the coach's units", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            {
              id: "ex-1",
              session_log_id: "log-1",
              training_exercise_id: "te-1",
              performed_name: null,
              prescribed_exercise_snapshot: strengthSnapshot("Back Squat", 1),
            },
          ]) as never,
        )
        .mockReturnValueOnce(setLogsQuery([setRow("ex-1", 1, { reps: 5, weight: 102.5 })]) as never);

      const result = await getExerciseSummariesForPeriod(["log-1"], "imperial");

      expect(result.get("log-1")?.[0]).toContain("Load (lbs) 225 (target 220–232.5 lbs)");
    });

    it("reads every measure a set recorded, not just reps, weight and RPE", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            {
              id: "ex-1",
              session_log_id: "log-1",
              training_exercise_id: "te-1",
              performed_name: null,
              prescribed_exercise_snapshot: {
                name: "Running",
                prescribed_fields: ["set_type", "distance", "duration", "pace", "rest"],
                set_specs: [
                  {
                    set_number: 1,
                    set_type: "working",
                    distance_meters_min: 5000,
                    distance_meters_max: 5000,
                    pace_seconds_per_km_min: 300,
                    pace_seconds_per_km_max: 320,
                  },
                ],
              },
            },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            setRow("ex-1", 1, { distance_meters: 5000, duration_seconds: 1570, pace_seconds_per_km: 330 }),
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(result.get("log-1")).toEqual([
        "Running — 1 of 1 working set: Distance 5 km (target 5 km); Duration 26:10; " +
          "Pace 5:30 /km (target 5:00–5:20 /km; above target)",
      ]);
    });

    it("reads the exercises in the order the coach wrote the session, anything outside the plan after", async () => {
      // A save's exercise logs share one created_at, so the read returns them
      // in no order that means anything; each snapshot records its place.
      const placed = (name: string, group: number, exercise: number) => ({
        name,
        order_index: exercise,
        group: { id: `g-${group}`, order_index: group, format: group === 1 ? "circuit" : "straight_sets", rounds: group === 1 ? 1 : null },
        set_specs: [{ set_number: 1, set_type: "working", reps_min: 5, reps_max: 5 }],
        prescribed_fields: ["set_type", "reps"],
      });
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-u", session_log_id: "log-1", performed_name: "Curl", prescribed_exercise_snapshot: { name: "Curl" } },
            { id: "ex-c", session_log_id: "log-1", training_exercise_id: "te-c", performed_name: null, prescribed_exercise_snapshot: placed("Row", 1, 1) },
            { id: "ex-d", session_log_id: "log-1", training_exercise_id: "te-d", performed_name: null, prescribed_exercise_snapshot: placed("Plank", 2, 0) },
            { id: "ex-a", session_log_id: "log-1", training_exercise_id: "te-a", performed_name: null, prescribed_exercise_snapshot: placed("Squat", 0, 0) },
            { id: "ex-b", session_log_id: "log-1", training_exercise_id: "te-b", performed_name: null, prescribed_exercise_snapshot: placed("Press", 1, 0) },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery(["ex-u", "ex-c", "ex-d", "ex-a", "ex-b"].map((id) => setRow(id, 1, { reps: 5 }))) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(result.get("log-1")?.map((line) => line.split(" — ")[0])).toEqual([
        "Squat",
        "Press",
        "Row",
        "Plank",
        "Curl",
      ]);
    });

    it("reads each exercise's sets by their number", async () => {
      const setQuery = setLogsQuery([setRow("ex-1", 1, { reps: 5 })]);
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-1", session_log_id: "log-1", performed_name: "Bench", prescribed_exercise_snapshot: null },
          ]) as never,
        )
        .mockReturnValueOnce(setQuery as never);

      await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(setQuery.order).toHaveBeenCalledWith("set_number", { ascending: true });
    });

    it("groups exercises under their session_log_id, and skips one with no set", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-1", session_log_id: "log-1", performed_name: "Bench", prescribed_exercise_snapshot: null },
            { id: "ex-2", session_log_id: "log-1", performed_name: "Skipped Row", prescribed_exercise_snapshot: null },
            { id: "ex-3", session_log_id: "log-2", performed_name: "Squat", prescribed_exercise_snapshot: null },
          ]) as never,
        )
        .mockReturnValueOnce(
          setLogsQuery([
            setRow("ex-1", 1, { reps: 5, weight: 100 }),
            setRow("ex-3", 1, { reps: 5, weight: 140 }),
          ]) as never,
        );

      const result = await getExerciseSummariesForPeriod(["log-1", "log-2"], "metric");

      expect(result.get("log-1")).toEqual(["Bench — 1 set, not in the plan: Load (kg) 100; Reps 5"]);
      expect(result.get("log-2")).toEqual(["Squat — 1 set, not in the plan: Load (kg) 140; Reps 5"]);
    });

    it("falls back to 'Unknown exercise' when both name sources are absent", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-1", session_log_id: "log-1", performed_name: null, prescribed_exercise_snapshot: null },
          ]) as never,
        )
        .mockReturnValueOnce(setLogsQuery([setRow("ex-1", 1, { reps: 5 })]) as never);

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(result.get("log-1")).toEqual(["Unknown exercise — 1 set, not in the plan: Reps 5"]);
    });

    it("caps at 8 lines per session and appends '…and N more'", async () => {
      const exLogs = Array.from({ length: 11 }, (_, i) => ({
        id: `ex-${i}`,
        session_log_id: "log-1",
        performed_name: `Exercise ${i}`,
        prescribed_exercise_snapshot: null,
      }));
      mockFrom
        .mockReturnValueOnce(exerciseLogsQuery(exLogs) as never)
        .mockReturnValueOnce(setLogsQuery(exLogs.map((ex) => setRow(ex.id, 1, { reps: 5 }))) as never);

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");
      const lines = result.get("log-1")!;

      // 8 kept lines + the overflow marker = 9 total.
      expect(lines).toHaveLength(9);
      expect(lines[0]).toBe("Exercise 0 — 1 set, not in the plan: Reps 5");
      expect(lines[7]).toBe("Exercise 7 — 1 set, not in the plan: Reps 5");
      expect(lines[8]).toBe("…and 3 more");
    });

    it("returns an empty Map (non-blocking) when the exercise_logs read errors", async () => {
      mockFrom.mockReturnValueOnce(exerciseLogsQuery(null, { message: "boom" }) as never);

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(result.size).toBe(0);
    });

    it("returns an empty Map (non-blocking) when the set_logs read errors", async () => {
      mockFrom
        .mockReturnValueOnce(
          exerciseLogsQuery([
            { id: "ex-1", session_log_id: "log-1", performed_name: "Bench", prescribed_exercise_snapshot: null },
          ]) as never,
        )
        .mockReturnValueOnce(setLogsQuery(null, { message: "boom" }) as never);

      const result = await getExerciseSummariesForPeriod(["log-1"], "metric");

      expect(result.size).toBe(0);
    });
  });
});
