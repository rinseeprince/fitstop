import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service. The service now talks to
// Postgres RPCs (migration 094); per-test we mock supabaseAdmin.rpc to return
// the post-aggregate / windowed row shape the RPCs produce.
//
// Test-layer boundary: aggregation + identity-union + windowing are SQL
// responsibilities (covered deterministically by scripts/perf-correctness.ts
// against the real DB). These unit tests cover the JS mapper + per-set math
// (top-set tiebreak, Epley-on-best-set, totalVolume, prescribed-snapshot
// extraction, null handling, isRecent).
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "./exercise-analytics-service";

const mockRpc = vi.mocked(supabaseAdmin.rpc);

const CLIENT_ID = "client-1";
const SESSION_LOG_1 = "sl-1";
const SESSION_LOG_2 = "sl-2";
const EXERCISE_LOG_1 = "el-1";
const EXERCISE_LOG_2 = "el-2";
const EXERCISE_ID = "exercise-uuid-1";

// Helper: returns the supabase rpc shape ({ data, error }).
// Cast to never to satisfy the strict typed overload — the RPC name is
// resolved via vi.mocked; we don't need to align rowtypes per call.
function mockRpcResolve(data: unknown) {
  mockRpc.mockResolvedValueOnce({ data, error: null } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// getClientExerciseList — thin mapper. SQL semantics (identity merge, frequency
// order, most-recent name) are pinned by scripts/perf-correctness.ts.
// =============================================================================

describe("getClientExerciseList", () => {
  it("returns empty array when RPC yields no rows", async () => {
    mockRpcResolve([]);
    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith("get_client_exercise_list", {
      p_client_id: CLIENT_ID,
    });
  });

  it("maps RPC rows to ExerciseListItem and coerces log_count", async () => {
    mockRpcResolve([
      {
        exercise_id: EXERCISE_ID,
        name: "Bench Press",
        log_count: 2,
        last_logged_date: "2026-04-08T00:00:00+00:00",
      },
      {
        exercise_id: "exercise-uuid-2",
        name: "Squat",
        log_count: 1,
        last_logged_date: "2026-04-01T00:00:00+00:00",
      },
    ]);

    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      exerciseId: EXERCISE_ID,
      name: "Bench Press",
      logCount: 2,
      lastLoggedDate: "2026-04-08T00:00:00+00:00",
    });
    expect(typeof result[0].logCount).toBe("number");
    expect(result[1].name).toBe("Squat");
  });

  it("preserves null exerciseId for legacy name-only rows", async () => {
    mockRpcResolve([
      {
        exercise_id: null,
        name: "Deadlift",
        log_count: 1,
        last_logged_date: "2026-04-01T00:00:00+00:00",
      },
    ]);
    const result = await getClientExerciseList(CLIENT_ID);
    expect(result[0].exerciseId).toBeNull();
    expect(result[0].name).toBe("Deadlift");
  });

  it("falls back to 'Unknown exercise' if SQL ever returns null name", async () => {
    // SQL has COALESCE(..., 'Unknown exercise') so this shouldn't happen in
    // practice, but the mapper is defense-in-depth.
    mockRpcResolve([
      {
        exercise_id: EXERCISE_ID,
        name: null,
        log_count: 1,
        last_logged_date: "2026-04-01T00:00:00+00:00",
      },
    ]);
    const result = await getClientExerciseList(CLIENT_ID);
    expect(result[0].name).toBe("Unknown exercise");
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    } as never);
    await expect(getClientExerciseList(CLIENT_ID)).rejects.toThrow(
      /Failed to fetch exercise list: boom/
    );
  });

  it("is ID-first: the row exposes exerciseId and never embeds catalog dictionary fields", async () => {
    // ID-first contract: history/list rows carry exercise_id (+ performed name
    // fallback), NOT the dictionary. Catalog fields (muscle_group, equipment,
    // aliases, category) are synced separately via the catalog delta endpoint,
    // so they must not leak onto an ExerciseListItem.
    mockRpcResolve([
      {
        exercise_id: EXERCISE_ID,
        name: "Bench Press",
        log_count: 3,
        last_logged_date: "2026-04-08T00:00:00+00:00",
        // Even if a future RPC over-selected these, the mapper must not pass
        // them through.
        muscle_group: "chest",
        equipment: "barbell",
        aliases: ["bp"],
        category: "compound",
      },
    ]);

    const result = await getClientExerciseList(CLIENT_ID);
    const row = result[0];

    expect(row.exerciseId).toBe(EXERCISE_ID);
    expect(Object.keys(row).sort()).toEqual([
      "exerciseId",
      "lastLoggedDate",
      "logCount",
      "name",
    ]);
    expect(row).not.toHaveProperty("muscle_group");
    expect(row).not.toHaveProperty("equipment");
    expect(row).not.toHaveProperty("aliases");
    expect(row).not.toHaveProperty("category");
  });
});

// =============================================================================
// getExerciseProgressionSeries — JS aggregation over bounded RPC rows. These
// assertions retain real teeth on the per-set math (top-set tiebreak,
// Epley-on-best-set, totalVolume, null handling, prescribed-snapshot extraction).
// SQL window cap is pinned deterministically in scripts/perf-correctness.ts.
// =============================================================================

describe("getExerciseProgressionSeries", () => {
  it("returns empty array when RPC yields no rows", async () => {
    mockRpcResolve([]);
    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_progression_window", {
      p_client_id: CLIENT_ID,
      p_exercise_id: EXERCISE_ID,
      p_exercise_name: undefined,
      p_session_count: 12,
    });
  });

  it("passes sessionCount through to RPC", async () => {
    mockRpcResolve([]);
    await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
      sessionCount: 7,
    });
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_progression_window", {
      p_client_id: CLIENT_ID,
      p_exercise_id: EXERCISE_ID,
      p_exercise_name: undefined,
      p_session_count: 7,
    });
  });

  it("computes top-set with reps-tiebreak, totalVolume, actualSets, prescribed", async () => {
    // One session with three sets — same shape as the prior fixture for this case.
    mockRpcResolve([
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: { sets: 3, reps_min: 8, reps_max: 12 },
        set_id: "s1",
        set_number: 1,
        reps: 10,
        weight: 80,
        rpe: 7,
      },
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: { sets: 3, reps_min: 8, reps_max: 12 },
        set_id: "s2",
        set_number: 2,
        reps: 8,
        weight: 100,
        rpe: 9,
      },
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: { sets: 3, reps_min: 8, reps_max: 12 },
        set_id: "s3",
        set_number: 3,
        reps: 6,
        weight: 100,
        rpe: 10,
      },
    ]);

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result).toHaveLength(1);
    const point = result[0];
    expect(point.topSetWeight).toBe(100);
    expect(point.topSetReps).toBe(8); // tiebreak on reps DESC at weight=100
    expect(point.topSetRpe).toBe(9); // from the row with (100, 8)
    expect(point.totalVolume).toBe(2200); // 10*80 + 8*100 + 6*100
    expect(point.actualSets).toBe(3);
    expect(point.prescribedSets).toBe(3);
    expect(point.prescribedRepsMin).toBe(8);
    expect(point.prescribedRepsMax).toBe(12);
  });

  it("computes Epley e1RM on the best-estimated set, not just heaviest", async () => {
    // Heavy single (120 @ 1) vs lighter higher-rep set (100 @ 10).
    // Best e1RM = 100 * (1 + 10/30) = 133.333... → 133.3
    mockRpcResolve([
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: null,
        set_id: "s1",
        set_number: 1,
        reps: 1,
        weight: 120,
        rpe: 10,
      },
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: null,
        set_id: "s2",
        set_number: 2,
        reps: 10,
        weight: 100,
        rpe: 8,
      },
    ]);

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result[0].estimatedOneRepMax).toBeCloseTo(133.3, 1);
  });

  it("handles sets with null weight gracefully", async () => {
    mockRpcResolve([
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: null,
        set_id: "s1",
        set_number: 1,
        reps: 10,
        weight: null,
        rpe: 7,
      },
    ]);
    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result[0].topSetWeight).toBeNull();
    expect(result[0].topSetReps).toBeNull();
    expect(result[0].topSetRpe).toBeNull();
    expect(result[0].totalVolume).toBeNull();
    expect(result[0].estimatedOneRepMax).toBeNull();
    expect(result[0].actualSets).toBe(1);
  });

  it("emits a progression point even when the windowed exercise_log has no sets", async () => {
    // RPC LEFT JOINs set_logs; an exercise_log with zero sets shows up as one
    // row with set_id/set_number/reps/weight/rpe all NULL.
    mockRpcResolve([
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: { sets: 3, reps_min: 8, reps_max: 12 },
        set_id: null,
        set_number: null,
        reps: null,
        weight: null,
        rpe: null,
      },
    ]);
    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toHaveLength(1);
    expect(result[0].actualSets).toBe(0);
    expect(result[0].topSetWeight).toBeNull();
    expect(result[0].totalVolume).toBeNull();
    expect(result[0].estimatedOneRepMax).toBeNull();
    expect(result[0].prescribedSets).toBe(3);
  });

  it("combines sets across multiple exercise_logs in the same session", async () => {
    // Same client logged the same exercise twice in one session — RPC returns
    // all sets across both exercise_logs; JS combines them into one point.
    // Snapshot is captured on group creation (first row encountered).
    mockRpcResolve([
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: { sets: 2 },
        set_id: "s1",
        set_number: 1,
        reps: 5,
        weight: 100,
        rpe: null,
      },
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_2,
        prescribed_exercise_snapshot: { sets: 2 },
        set_id: "s2",
        set_number: 1,
        reps: 8,
        weight: 80,
        rpe: null,
      },
    ]);
    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toHaveLength(1);
    expect(result[0].actualSets).toBe(2);
    expect(result[0].topSetWeight).toBe(100);
    expect(result[0].totalVolume).toBe(5 * 100 + 8 * 80);
    expect(result[0].prescribedSets).toBe(2);
  });

  it("sorts progression points by date ASC across multiple sessions", async () => {
    // RPC orders ASC; the JS sort is defensive against a future RPC reordering.
    mockRpcResolve([
      {
        session_log_id: SESSION_LOG_1,
        completed_at: "2026-03-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_1,
        prescribed_exercise_snapshot: null,
        set_id: "s1",
        set_number: 1,
        reps: 5,
        weight: 100,
        rpe: null,
      },
      {
        session_log_id: SESSION_LOG_2,
        completed_at: "2026-04-01T00:00:00+00:00",
        exercise_log_id: EXERCISE_LOG_2,
        prescribed_exercise_snapshot: null,
        set_id: "s2",
        set_number: 1,
        reps: 5,
        weight: 110,
        rpe: null,
      },
    ]);
    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2026-03-01T00:00:00+00:00");
    expect(result[1].date).toBe("2026-04-01T00:00:00+00:00");
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    } as never);
    await expect(
      getExerciseProgressionSeries(CLIENT_ID, { exerciseId: EXERCISE_ID })
    ).rejects.toThrow(/Failed to fetch exercise progression: boom/);
  });
});

// =============================================================================
// getExercisePRs — thin mapper + JS-side isRecent (28-day comparison).
// SQL DISTINCT ON best-per-reps + completed_at-ASC tiebreak are pinned by
// scripts/perf-correctness.ts.
// =============================================================================

describe("getExercisePRs", () => {
  it("returns empty array when RPC yields no rows", async () => {
    mockRpcResolve([]);
    const result = await getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_prs", {
      p_client_id: CLIENT_ID,
      p_exercise_id: EXERCISE_ID,
      p_exercise_name: undefined,
    });
  });

  it("maps RPC rows to ExercisePR and coerces weight to number", async () => {
    mockRpcResolve([
      { reps: 5, weight: 110, date: "2026-04-08T00:00:00+00:00" },
      { reps: 8, weight: 80, date: "2026-04-01T00:00:00+00:00" },
    ]);
    const result = await getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ reps: 5, weight: 110 });
    expect(typeof result[0].weight).toBe("number");
    expect(result[1]).toMatchObject({ reps: 8, weight: 80 });
  });

  it("sets isRecent true within 28 days, false beyond", async () => {
    const now = new Date();
    const recent = new Date(
      now.getTime() - 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const old = new Date(
      now.getTime() - 60 * 24 * 60 * 60 * 1000
    ).toISOString();

    mockRpcResolve([
      { reps: 5, weight: 120, date: old },
      { reps: 10, weight: 80, date: recent },
    ]);
    const result = await getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID });
    expect(result.find((p) => p.reps === 5)?.isRecent).toBe(false);
    expect(result.find((p) => p.reps === 10)?.isRecent).toBe(true);
  });

  it("passes exerciseName through to RPC", async () => {
    mockRpcResolve([]);
    await getExercisePRs(CLIENT_ID, { exerciseName: "Deadlift" });
    expect(mockRpc).toHaveBeenCalledWith("get_exercise_prs", {
      p_client_id: CLIENT_ID,
      p_exercise_id: undefined,
      p_exercise_name: "Deadlift",
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    } as never);
    await expect(
      getExercisePRs(CLIENT_ID, { exerciseId: EXERCISE_ID })
    ).rejects.toThrow(/Failed to fetch exercise PRs: boom/);
  });
});
