import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service. The service talks to
// Postgres RPCs (migrations 094 to 191); per-test we mock supabaseAdmin.rpc to
// return the windowed row shape the RPCs produce.
//
// Test-layer boundary: the identity, windowing and the records' SQL are
// covered against the real DB by scripts/perf-correctness.ts, and the
// functions' text by services/exercise-analytics-functions.test.ts and
// utils/race-distances.test.ts. The per-session marker math is
// utils/exercise-session-markers.test.ts. These tests cover the JS mapper: RPC
// arguments, grouping by session, the prescribed snapshot, the set-row mapping
// into the kernel, the records' kinds, races, sessions and isRecent, and every
// exercise's bests.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  getClientExerciseBests,
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "./exercise-analytics-service";

const mockRpc = vi.mocked(supabaseAdmin.rpc);
const mockFrom = vi.mocked(supabaseAdmin.from);

/**
 * The session logs' calendar workouts, read by id after the progression RPC:
 * each log's is "ev-<log id>" unless the case says otherwise. Records the ids
 * each read asked for.
 */
function mockSessionLogEvents(eventFor: (id: string) => string | null = (id) => `ev-${id}`) {
  const asked: string[][] = [];
  mockFrom.mockImplementation((() => {
    let ids: string[] = [];
    const builder = {
      select: () => builder,
      in: (_column: string, values: string[]) => {
        ids = values;
        asked.push(values);
        return builder;
      },
      order: () => builder,
      range: () =>
        Promise.resolve({ data: ids.map((id) => ({ id, training_event_id: eventFor(id) })), error: null }),
    };
    return builder;
  }) as never);
  return asked;
}

const CLIENT_ID = "client-1";
const SESSION_LOG_1 = "sl-1";
const SESSION_LOG_2 = "sl-2";
const EXERCISE_LOG_1 = "el-1";
const EXERCISE_LOG_2 = "el-2";
const EXERCISE_ID = "exercise-uuid-1";

// Cast to never to satisfy the strict typed overload — the RPC name is
// resolved via vi.mocked; we don't need to align rowtypes per call.
function mockRpcResolve(data: unknown) {
  mockRpc.mockResolvedValueOnce({ data, error: null } as never);
}

/** One flat progression row: a session's exercise log with one of its sets (or none). */
function progressionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_log_id: SESSION_LOG_1,
    completed_at: "2026-05-01T00:00:00Z",
    exercise_log_id: EXERCISE_LOG_1,
    prescribed_exercise_snapshot: null,
    set_id: "set-1",
    set_number: 1,
    set_type: "working",
    reps: null,
    weight: null,
    rpe: null,
    rir: null,
    distance_meters: null,
    duration_seconds: null,
    pace_seconds_per_km: null,
    split_seconds_per_500m: null,
    calories: null,
    cadence: null,
    stroke_rate: null,
    resistance: null,
    heart_rate_zone: null,
    heart_rate: null,
    power: null,
    ftp_percent: null,
    rest_seconds: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionLogEvents();
});

// =============================================================================
// getClientExerciseList
// =============================================================================

describe("getClientExerciseList", () => {
  it("returns empty array when RPC yields no rows", async () => {
    mockRpcResolve([]);
    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith("get_client_exercise_list", {
      p_client_id: CLIENT_ID,
      p_start_date: undefined,
      p_end_date: undefined,
    });
  });

  it("passes a date window through to the RPC", async () => {
    mockRpcResolve([]);
    await getClientExerciseList(CLIENT_ID, { startDate: "2026-05-01", endDate: "2026-05-31" });
    expect(mockRpc).toHaveBeenCalledWith("get_client_exercise_list", {
      p_client_id: CLIENT_ID,
      p_start_date: "2026-05-01",
      p_end_date: "2026-05-31",
    });
  });

  it("maps rows, reading the catalog type and Strength for a freehand name", async () => {
    mockRpcResolve([
      { exercise_id: EXERCISE_ID, name: "Rowing", log_count: 7, last_logged_date: "2026-05-22T00:00:00Z", exercise_type: "erg" },
      { exercise_id: null, name: "Deadlift", log_count: 1, last_logged_date: "2026-05-01T00:00:00Z", exercise_type: null },
      { exercise_id: "x", name: null, log_count: "2", last_logged_date: "2026-05-02T00:00:00Z", exercise_type: "not-a-type" },
    ]);
    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toEqual([
      { exerciseId: EXERCISE_ID, name: "Rowing", logCount: 7, lastLoggedDate: "2026-05-22T00:00:00Z", exerciseType: "erg" },
      { exerciseId: null, name: "Deadlift", logCount: 1, lastLoggedDate: "2026-05-01T00:00:00Z", exerciseType: "strength" },
      { exerciseId: "x", name: "Unknown exercise", logCount: 2, lastLoggedDate: "2026-05-02T00:00:00Z", exerciseType: "strength" },
    ]);
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(getClientExerciseList(CLIENT_ID)).rejects.toThrow("Failed to fetch exercise list: boom");
  });
});

// =============================================================================
// getExerciseProgressionSeries
// =============================================================================

describe("getExerciseProgressionSeries", () => {
  it("omits p_session_count and the window when none is given (the RPC's COALESCE owns the cap)", async () => {
    mockRpcResolve([]);
    await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_progression_window", {
      p_client_id: CLIENT_ID,
      p_exercise_id: EXERCISE_ID,
      p_exercise_name: undefined,
      p_session_count: undefined,
      p_start_date: undefined,
      p_end_date: undefined,
    });
  });

  it("passes the name, the session count and the window through", async () => {
    mockRpcResolve([]);
    await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseName: "Bench Press",
      sessionCount: 24,
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_progression_window", {
      p_client_id: CLIENT_ID,
      p_exercise_id: undefined,
      p_exercise_name: "Bench Press",
      p_session_count: 24,
      p_start_date: "2026-05-01",
      p_end_date: "2026-05-31",
    });
  });

  it("groups a session's sets across its exercise logs into one point, sorted by date", async () => {
    mockRpcResolve([
      progressionRow({ session_log_id: SESSION_LOG_2, completed_at: "2026-05-08T00:00:00Z", exercise_log_id: EXERCISE_LOG_2, set_id: "s3", reps: 5, weight: "110" }),
      progressionRow({ set_id: "s1", reps: 8, weight: "80", rpe: "7" }),
      progressionRow({ set_id: "s2", set_number: 2, exercise_log_id: "el-1b", reps: 5, weight: "100", rpe: "8.5" }),
    ]);
    const points = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(points.map((p) => p.sessionLogId)).toEqual([SESSION_LOG_1, SESSION_LOG_2]);
    expect(points[0]).toMatchObject({
      date: "2026-05-01T00:00:00Z",
      topSetWeight: 100,
      topSetReps: 5,
      rpe: 8.5,
      totalVolume: 8 * 80 + 5 * 100,
      estimatedOneRepMax: 116.7,
      actualSets: 2,
    });
    expect(points[1]).toMatchObject({ topSetWeight: 110, actualSets: 1 });
  });

  it("emits a point for a zero-set exercise log", async () => {
    mockRpcResolve([progressionRow({ set_id: null, set_number: null, set_type: null })]);
    const points = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ actualSets: 0, sets: [], topSetWeight: null, averagePaceSecondsPerKm: null });
  });

  it("hands every measure of a set to the kernel: an erg session as a whole", async () => {
    mockRpcResolve([
      progressionRow({ set_id: "s1", distance_meters: "1000.00", duration_seconds: "222.1", split_seconds_per_500m: "111.0", power: 215 }),
      progressionRow({ set_id: "s2", set_number: 2, distance_meters: "500.00", duration_seconds: "105.0", split_seconds_per_500m: "105.0", power: 240 }),
    ]);
    const [point] = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(point).toMatchObject({
      sets: [
        { weight: null, reps: null, distanceMeters: 1000, durationSeconds: 222.1 },
        { weight: null, reps: null, distanceMeters: 500, durationSeconds: 105 },
      ],
      totalDistanceMeters: 1500,
      totalDurationSeconds: 327.1,
      // 327.1 s over three 500 m lengths
      averageSplitSecondsPer500m: 109,
      averagePower: 228,
      longestHoldSeconds: null,
      topSetWeight: null,
    });
  });

  it("hands every other measure the read returns to the kernel: the Sessions table's figures", async () => {
    mockRpcResolve([
      progressionRow({ set_id: "s1", distance_meters: "4000.00", duration_seconds: "1200.0", pace_seconds_per_km: 300, rpe: "7.5", stroke_rate: 24, heart_rate_zone: 3 }),
      progressionRow({ set_id: "s2", set_number: 2, distance_meters: "1000.00", duration_seconds: "280.0", pace_seconds_per_km: 280, rpe: "8.5", stroke_rate: 28, heart_rate_zone: 4 }),
    ]);
    const [point] = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(point).toMatchObject({
      // No loaded set: the hardest effort logged stands in for the top set's
      rpe: 8.5,
      averageStrokeRate: 26,
      maxHeartRateZone: 4,
      totalDistanceMeters: 5000,
      totalDurationSeconds: 1480,
      averagePaceSecondsPerKm: 296,
    });
  });

  it("carries each session's calendar workout, none where the log has none, asking once per hundred sessions", async () => {
    const asked = mockSessionLogEvents((id) => (id === SESSION_LOG_2 ? null : `ev-${id}`));
    mockRpcResolve([
      progressionRow({ set_id: "s1" }),
      progressionRow({ session_log_id: SESSION_LOG_2, completed_at: "2026-05-08T00:00:00Z", set_id: "s2" }),
    ]);
    const points = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(points.map((p) => [p.sessionLogId, p.eventId])).toEqual([
      [SESSION_LOG_1, `ev-${SESSION_LOG_1}`],
      [SESSION_LOG_2, null],
    ]);
    expect(mockFrom).toHaveBeenCalledWith("session_logs");
    expect(asked).toEqual([[SESSION_LOG_1, SESSION_LOG_2]]);

    // A long window asks in chunks the request line can carry
    const many = mockSessionLogEvents();
    mockRpcResolve(
      Array.from({ length: 150 }, (_, i) =>
        progressionRow({ session_log_id: `sl-${i}`, completed_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, set_id: `s-${i}` }),
      ),
    );
    await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(many.map((ids) => ids.length)).toEqual([100, 50]);
  });

  it("asks nothing more when the window holds no session", async () => {
    mockRpcResolve([]);
    expect(await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID })).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("excludes warm-ups and guards a null set type as working", async () => {
    mockRpcResolve([
      progressionRow({ set_id: "s1", set_type: "warmup", reps: 10, weight: "40" }),
      progressionRow({ set_id: "s2", set_number: 2, set_type: null, reps: 5, weight: "100" }),
    ]);
    const [point] = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(point).toMatchObject({ topSetWeight: 100, totalVolume: 500, actualSets: 1 });
  });

  it("reads the prescribed working sets and rep range off the snapshot", async () => {
    mockRpcResolve([
      progressionRow({
        prescribed_exercise_snapshot: {
          sets: 4,
          reps_min: 8,
          reps_max: 12,
          set_specs: [
            { set_number: 1, set_type: "warmup" },
            { set_number: 2, set_type: "working" },
            { set_number: 3, set_type: "working" },
            { set_number: 4, set_type: "failure" },
          ],
        },
        reps: 10,
        weight: "60",
      }),
    ]);
    const [point] = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(point).toMatchObject({ prescribedSets: 3, prescribedRepsMin: 8, prescribedRepsMax: 12 });
  });

  it("leaves the prescription unknown when the snapshot carries neither sets nor specs", async () => {
    mockRpcResolve([progressionRow({ prescribed_exercise_snapshot: { name: "Legacy" }, reps: 5, weight: "100" })]);
    const [point] = await getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(point.prescribedSets).toBeNull();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID })).rejects.toThrow(
      "Failed to fetch exercise progression: boom",
    );
  });
});

// =============================================================================
// getExercisePRs
// =============================================================================

describe("getExercisePRs", () => {
  it("omits p_exclude_dates unless days are excluded", async () => {
    mockRpcResolve([]);
    await getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_prs", {
      p_client_id: CLIENT_ID,
      p_exercise_id: EXERCISE_ID,
      p_exercise_name: undefined,
      p_exclude_dates: undefined,
    });

    mockRpcResolve([]);
    await getExercisePRs(CLIENT_ID, { exerciseName: "Rowing", excludeDates: ["2026-05-08"] });
    expect(mockRpc).toHaveBeenLastCalledWith("get_exercise_prs", {
      p_client_id: CLIENT_ID,
      p_exercise_id: undefined,
      p_exercise_name: "Rowing",
      p_exclude_dates: ["2026-05-08"],
    });
  });

  it("maps every kind to its shape and flags the recent ones", async () => {
    const now = Date.now();
    const recent = new Date(now - 27 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
    const row = (overrides: Record<string, unknown>) => ({
      reps: null,
      weight: null,
      distance_meters: null,
      duration_seconds: null,
      race: null,
      session_log_id: SESSION_LOG_1,
      ...overrides,
    });
    mockRpcResolve([
      row({ kind: "rep_max", reps: 5, weight: "110", date: recent }),
      row({ kind: "best_reps", reps: 15, date: old, session_log_id: SESSION_LOG_2 }),
      row({ kind: "best_time", distance_meters: "5000", duration_seconds: "1204.80000", race: "5k", date: recent }),
      row({ kind: "best_time", distance_meters: "40.00", duration_seconds: "35.0", date: old }),
      row({ kind: "heaviest_carry", weight: "64", distance_meters: "40.00", date: old }),
      row({ kind: "longest_hold", duration_seconds: "120.0", date: old }),
    ]);
    const records = await getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(records).toEqual([
      { kind: "rep_max", reps: 5, weight: 110, date: recent, sessionLogId: SESSION_LOG_1, isRecent: true },
      { kind: "best_reps", reps: 15, date: old, sessionLogId: SESSION_LOG_2, isRecent: false },
      // At a race distance: its length and its name
      {
        kind: "best_time",
        distanceMeters: 5000,
        durationSeconds: 1204.8,
        race: "5k",
        date: recent,
        sessionLogId: SESSION_LOG_1,
        isRecent: true,
      },
      // At the distance logged: no race
      {
        kind: "best_time",
        distanceMeters: 40,
        durationSeconds: 35,
        race: null,
        date: old,
        sessionLogId: SESSION_LOG_1,
        isRecent: false,
      },
      { kind: "heaviest_carry", distanceMeters: 40, weight: 64, date: old, sessionLogId: SESSION_LOG_1, isRecent: false },
      { kind: "longest_hold", durationSeconds: 120, date: old, sessionLogId: SESSION_LOG_1, isRecent: false },
    ]);
  });

  it("drops a row of an unknown kind or one missing its measure, and reads an unknown race as none", async () => {
    mockRpcResolve([
      { kind: "fastest_mile", reps: null, weight: null, distance_meters: "1609.34", duration_seconds: "400", race: null, date: "2026-05-01T00:00:00Z", session_log_id: SESSION_LOG_1 },
      { kind: "rep_max", reps: 5, weight: null, distance_meters: null, duration_seconds: null, race: null, date: "2026-05-01T00:00:00Z", session_log_id: SESSION_LOG_1 },
      { kind: "best_time", reps: null, weight: null, distance_meters: "15000", duration_seconds: "3600", race: "15k", date: "2026-05-01T00:00:00Z", session_log_id: SESSION_LOG_1 },
    ]);
    expect(await getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID })).toEqual([
      expect.objectContaining({ kind: "best_time", distanceMeters: 15000, race: null }),
    ]);
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID })).rejects.toThrow("Failed to fetch exercise PRs: boom");
  });
});

// =============================================================================
// getClientExerciseBests
// =============================================================================

describe("getClientExerciseBests", () => {
  /** One exercise's row of get_client_exercise_bests: nothing but its facts unless the case says so. */
  const bestsRow = (overrides: Record<string, unknown> = {}) => ({
    exercise_id: EXERCISE_ID,
    name: "Barbell Bench Press",
    exercise_type: "strength",
    session_count: 18,
    last_logged_date: "2026-09-20T00:00:00+00:00",
    heaviest_load: null,
    best_e1rm_weight: null,
    best_e1rm_reps: null,
    best_reps: null,
    best_time_race: null,
    best_time_seconds: null,
    heaviest_carry_weight: null,
    heaviest_carry_distance_meters: null,
    longest_hold_seconds: null,
    ...overrides,
  });

  it("asks for the client's every exercise in one call", async () => {
    mockRpcResolve([]);
    expect(await getClientExerciseBests(CLIENT_ID)).toEqual([]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("get_client_exercise_bests", { p_client_id: CLIENT_ID });
  });

  it("maps each exercise's bests, working out its e1RM as the Sessions table does", async () => {
    mockRpcResolve([
      bestsRow({ heaviest_load: "110.00", best_e1rm_weight: "102.50", best_e1rm_reps: 8 }),
      bestsRow({
        exercise_id: "run",
        name: "Running",
        exercise_type: "endurance",
        session_count: 13,
        best_time_race: "half_marathon",
        best_time_seconds: "5530.00000",
      }),
      bestsRow({
        exercise_id: "carry",
        name: "Farmer Carry",
        exercise_type: "carry_sled",
        heaviest_carry_weight: "70.00",
        heaviest_carry_distance_meters: "40.00",
      }),
      bestsRow({ exercise_id: null, name: "Wall sit", exercise_type: null, best_reps: 12, longest_hold_seconds: "95.0" }),
    ]);
    expect(await getClientExerciseBests(CLIENT_ID)).toEqual([
      {
        exerciseId: EXERCISE_ID,
        name: "Barbell Bench Press",
        exerciseType: "strength",
        sessionCount: 18,
        lastLoggedDate: "2026-09-20T00:00:00+00:00",
        heaviestLoad: 110,
        // Epley: 102.5 x (1 + 8/30), to a tenth
        bestEstimatedOneRepMax: 129.8,
        bestSetReps: null,
        bestTime: null,
        heaviestCarry: null,
        longestHoldSeconds: null,
      },
      expect.objectContaining({
        exerciseId: "run",
        exerciseType: "endurance",
        bestTime: { race: "half_marathon", durationSeconds: 5530 },
        heaviestLoad: null,
        bestEstimatedOneRepMax: null,
      }),
      expect.objectContaining({ exerciseType: "carry_sled", heaviestCarry: { weight: 70, distanceMeters: 40 } }),
      // A freehand name has no catalog row and reads as Strength
      expect.objectContaining({ exerciseId: null, exerciseType: "strength", bestSetReps: 12, longestHoldSeconds: 95 }),
    ]);
  });

  it("reads a single's e1RM as its weight, and an unknown race as no best time", async () => {
    mockRpcResolve([
      bestsRow({ best_e1rm_weight: "140", best_e1rm_reps: 1, best_time_race: "15k", best_time_seconds: "3600" }),
    ]);
    const [row] = await getClientExerciseBests(CLIENT_ID);
    expect(row.bestEstimatedOneRepMax).toBe(140);
    expect(row.bestTime).toBeNull();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(getClientExerciseBests(CLIENT_ID)).rejects.toThrow("Failed to fetch exercise bests: boom");
  });
});
