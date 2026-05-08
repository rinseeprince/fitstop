import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service.
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Chainable supabase query mock.
function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return q;
}

import { supabaseAdmin } from "./supabase-admin";
import {
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "./exercise-analytics-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

// ---- shared fixtures ----

const CLIENT_ID = "client-1";
const SESSION_LOG_1 = "sl-1";
const SESSION_LOG_2 = "sl-2";
const EXERCISE_LOG_1 = "el-1";
const EXERCISE_LOG_2 = "el-2";
const EXERCISE_LOG_3 = "el-3";
const EXERCISE_ID = "exercise-uuid-1";
const TE_ID = "te-1";

// Router: dispatches mockFrom calls to the right mock by table name.
function installRouter(routes: Record<string, ReturnType<typeof createMockQuery>>) {
  mockFrom.mockImplementation((table: string) => {
    const mock = routes[table];
    if (!mock) throw new Error(`Unexpected table: ${table}`);
    return mock as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// getClientExerciseList
// =============================================================================

describe("getClientExerciseList", () => {
  it("returns empty array when no session logs exist", async () => {
    installRouter({
      session_logs: createMockQuery({ data: [], error: null }),
    });

    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toEqual([]);
  });

  it("groups by exercise_id and orders by frequency", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [
          { id: SESSION_LOG_1, completed_at: "2026-04-01" },
          { id: SESSION_LOG_2, completed_at: "2026-04-08" },
        ],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
          {
            id: EXERCISE_LOG_2,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_2,
            prescribed_exercise_snapshot: null,
          },
          {
            id: EXERCISE_LOG_3,
            exercise_id: "exercise-uuid-2",
            training_exercise_id: null,
            performed_name: "Squat",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
    });

    const result = await getClientExerciseList(CLIENT_ID);

    expect(result).toHaveLength(2);
    // Bench Press logged twice, Squat once → Bench first
    expect(result[0].name).toBe("Bench Press");
    expect(result[0].logCount).toBe(2);
    expect(result[0].exerciseId).toBe(EXERCISE_ID);
    expect(result[1].name).toBe("Squat");
    expect(result[1].logCount).toBe(1);
  });

  it("uses name fallback for legacy rows without exercise_id", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: null,
            training_exercise_id: null,
            performed_name: "Deadlift",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
    });

    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].exerciseId).toBeNull();
    expect(result[0].name).toBe("Deadlift");
  });

  it("resolves name from most recent log in a group", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [
          { id: SESSION_LOG_1, completed_at: "2026-04-01" },
          { id: SESSION_LOG_2, completed_at: "2026-04-15" },
        ],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "DB Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
          {
            id: EXERCISE_LOG_2,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Dumbbell Bench Press",
            session_log_id: SESSION_LOG_2,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
    });

    const result = await getClientExerciseList(CLIENT_ID);
    expect(result[0].name).toBe("Dumbbell Bench Press");
  });

  it("merges logs from both identity paths into one group", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [
          { id: SESSION_LOG_1, completed_at: "2026-04-01" },
          { id: SESSION_LOG_2, completed_at: "2026-04-08" },
        ],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          // Direct exercise_id path
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
          // Via training_exercises path
          {
            id: EXERCISE_LOG_2,
            exercise_id: null,
            training_exercise_id: TE_ID,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_2,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({
        data: [{ id: TE_ID, exercise_id: EXERCISE_ID }],
        error: null,
      }),
    });

    const result = await getClientExerciseList(CLIENT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].logCount).toBe(2);
    expect(result[0].exerciseId).toBe(EXERCISE_ID);
  });
});

// =============================================================================
// getExerciseProgressionSeries
// =============================================================================

describe("getExerciseProgressionSeries", () => {
  it("returns empty array when no logs match", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: "other-exercise",
            training_exercise_id: null,
            performed_name: "Squat",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
    });

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toEqual([]);
  });

  it("computes correct aggregations from set logs", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: {
              sets: 3,
              reps_min: 8,
              reps_max: 12,
            },
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({
        data: [
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 10,
            weight: 80,
            rpe: 7,
            created_at: "2026-04-01",
          },
          {
            id: "s2",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 2,
            reps: 8,
            weight: 100,
            rpe: 9,
            created_at: "2026-04-01",
          },
          {
            id: "s3",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 3,
            reps: 6,
            weight: 100,
            rpe: 10,
            created_at: "2026-04-01",
          },
        ],
        error: null,
      }),
    });

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result).toHaveLength(1);
    const point = result[0];
    // topSetWeight: MAX(80, 100, 100) = 100
    expect(point.topSetWeight).toBe(100);
    // topSetReps: at weight 100, tiebreak higher reps = 8
    expect(point.topSetReps).toBe(8);
    // topSetRpe: RPE from set with weight 100, reps 8 = 9
    expect(point.topSetRpe).toBe(9);
    // totalVolume: 10*80 + 8*100 + 6*100 = 800 + 800 + 600 = 2200
    expect(point.totalVolume).toBe(2200);
    // actualSets: 3
    expect(point.actualSets).toBe(3);
    // prescribed
    expect(point.prescribedSets).toBe(3);
    expect(point.prescribedRepsMin).toBe(8);
    expect(point.prescribedRepsMax).toBe(12);
  });

  it("computes Epley e1RM on the best-estimated set, not just heaviest", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({
        data: [
          // Heavy single: e1RM = 120 (1 rep, no extrapolation)
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 1,
            weight: 120,
            rpe: 10,
            created_at: "2026-04-01",
          },
          // Lighter set with higher reps: e1RM = 100 * (1 + 10/30) = 133.33
          {
            id: "s2",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 2,
            reps: 10,
            weight: 100,
            rpe: 8,
            created_at: "2026-04-01",
          },
        ],
        error: null,
      }),
    });

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    // Best e1RM should be 133.3 (from the lighter higher-rep set), not 120
    expect(result[0].estimatedOneRepMax).toBeCloseTo(133.3, 1);
  });

  it("respects sessionCount limit", async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      id: `sl-${i}`,
      completed_at: `2026-04-0${i + 1}`,
    }));
    const exerciseLogs = sessions.map((s, i) => ({
      id: `el-${i}`,
      exercise_id: EXERCISE_ID,
      training_exercise_id: null,
      performed_name: "Bench Press",
      session_log_id: s.id,
      prescribed_exercise_snapshot: null,
    }));
    const setLogs = exerciseLogs.map((el) => ({
      id: `set-${el.id}`,
      exercise_log_id: el.id,
      set_number: 1,
      reps: 5,
      weight: 100,
      rpe: null,
      created_at: "2026-04-01",
    }));

    installRouter({
      session_logs: createMockQuery({ data: sessions, error: null }),
      exercise_logs: createMockQuery({ data: exerciseLogs, error: null }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({ data: setLogs, error: null }),
    });

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
      sessionCount: 3,
    });

    expect(result).toHaveLength(3);
    // Should be the 3 most recent sessions
    expect(result[0].date).toBe("2026-04-03");
    expect(result[2].date).toBe("2026-04-05");
  });

  it("handles sets with null weight gracefully", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Pull-up",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({
        data: [
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 10,
            weight: null,
            rpe: 7,
            created_at: "2026-04-01",
          },
        ],
        error: null,
      }),
    });

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result[0].topSetWeight).toBeNull();
    expect(result[0].totalVolume).toBeNull();
    expect(result[0].estimatedOneRepMax).toBeNull();
    expect(result[0].actualSets).toBe(1);
  });

  it("finds logs via training_exercises.exercise_id path", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: null,
            training_exercise_id: TE_ID,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({
        data: [{ id: TE_ID, exercise_id: EXERCISE_ID }],
        error: null,
      }),
      set_logs: createMockQuery({
        data: [
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 5,
            weight: 100,
            rpe: null,
            created_at: "2026-04-01",
          },
        ],
        error: null,
      }),
    });

    const result = await getExerciseProgressionSeries(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result).toHaveLength(1);
    expect(result[0].topSetWeight).toBe(100);
  });
});

// =============================================================================
// getExercisePRs
// =============================================================================

describe("getExercisePRs", () => {
  it("returns empty array when no logs match", async () => {
    installRouter({
      session_logs: createMockQuery({ data: [], error: null }),
    });

    const result = await getExercisePRs(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toEqual([]);
  });

  it("returns best weight per rep count, ordered by reps", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [
          { id: SESSION_LOG_1, completed_at: "2026-04-01" },
          { id: SESSION_LOG_2, completed_at: "2026-04-08" },
        ],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
          {
            id: EXERCISE_LOG_2,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_2,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({
        data: [
          // Session 1: 5 reps @ 100, 8 reps @ 80
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 5,
            weight: 100,
            rpe: null,
            created_at: "2026-04-01",
          },
          {
            id: "s2",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 2,
            reps: 8,
            weight: 80,
            rpe: null,
            created_at: "2026-04-01",
          },
          // Session 2: 5 reps @ 110 (new PR), 8 reps @ 75 (no PR)
          {
            id: "s3",
            exercise_log_id: EXERCISE_LOG_2,
            set_number: 1,
            reps: 5,
            weight: 110,
            rpe: null,
            created_at: "2026-04-08",
          },
          {
            id: "s4",
            exercise_log_id: EXERCISE_LOG_2,
            set_number: 2,
            reps: 8,
            weight: 75,
            rpe: null,
            created_at: "2026-04-08",
          },
        ],
        error: null,
      }),
    });

    const result = await getExercisePRs(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result).toHaveLength(2);
    // Sorted by reps ascending
    expect(result[0]).toMatchObject({ reps: 5, weight: 110 });
    expect(result[1]).toMatchObject({ reps: 8, weight: 80 });
  });

  it("sets isRecent to true for PRs within 28 days", async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    installRouter({
      session_logs: createMockQuery({
        data: [
          { id: SESSION_LOG_1, completed_at: oldDate },
          { id: SESSION_LOG_2, completed_at: recentDate },
        ],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
          {
            id: EXERCISE_LOG_2,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_2,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({
        data: [
          // Old session: 5 reps @ 120 (PR but old)
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 5,
            weight: 120,
            rpe: null,
            created_at: oldDate,
          },
          // Recent session: 10 reps @ 80 (PR and recent)
          {
            id: "s2",
            exercise_log_id: EXERCISE_LOG_2,
            set_number: 1,
            reps: 10,
            weight: 80,
            rpe: null,
            created_at: recentDate,
          },
        ],
        error: null,
      }),
    });

    const result = await getExercisePRs(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result).toHaveLength(2);
    const pr5 = result.find((p) => p.reps === 5)!;
    const pr10 = result.find((p) => p.reps === 10)!;
    expect(pr5.isRecent).toBe(false);
    expect(pr10.isRecent).toBe(true);
  });

  it("excludes sets with null weight or zero weight", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: EXERCISE_ID,
            training_exercise_id: null,
            performed_name: "Pull-up",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({ data: [], error: null }),
      set_logs: createMockQuery({
        data: [
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 10,
            weight: null,
            rpe: null,
            created_at: "2026-04-01",
          },
          {
            id: "s2",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 2,
            reps: 8,
            weight: 0,
            rpe: null,
            created_at: "2026-04-01",
          },
        ],
        error: null,
      }),
    });

    const result = await getExercisePRs(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });
    expect(result).toEqual([]);
  });

  it("finds PRs via training_exercises.exercise_id path", async () => {
    installRouter({
      session_logs: createMockQuery({
        data: [{ id: SESSION_LOG_1, completed_at: "2026-04-01" }],
        error: null,
      }),
      exercise_logs: createMockQuery({
        data: [
          {
            id: EXERCISE_LOG_1,
            exercise_id: null,
            training_exercise_id: TE_ID,
            performed_name: "Bench Press",
            session_log_id: SESSION_LOG_1,
            prescribed_exercise_snapshot: null,
          },
        ],
        error: null,
      }),
      training_exercises: createMockQuery({
        data: [{ id: TE_ID, exercise_id: EXERCISE_ID }],
        error: null,
      }),
      set_logs: createMockQuery({
        data: [
          {
            id: "s1",
            exercise_log_id: EXERCISE_LOG_1,
            set_number: 1,
            reps: 3,
            weight: 140,
            rpe: null,
            created_at: "2026-04-01",
          },
        ],
        error: null,
      }),
    });

    const result = await getExercisePRs(CLIENT_ID, {
      exerciseId: EXERCISE_ID,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reps: 3, weight: 140 });
  });
});
