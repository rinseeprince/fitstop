import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock exercise catalog service
vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn(),
}));

// Inline query mock helper — the RICH variant (coach-library.test.ts): the
// create/overwrite paths chain .in/.or/.update, which the narrower factory
// used by the old duplicate test lacked.
function createMockQuery<T = unknown>(result: { data: T | null; error: { message: string } | null }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
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
import { resolveExercises } from "./exercise-catalog-service";
import {
  createStandaloneSession,
  createStandaloneSessionDeduped,
  getStandaloneSessions,
  overwriteStandaloneSession,
} from "./coach-standalone-session-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockResolveExercises = vi.mocked(resolveExercises);

const exerciseRow = {
  id: "e1",
  saved_session_id: "s1",
  exercise_id: "ex-3",
  name: "Squat",
  order_index: 0,
  sets: 4,
  reps_min: 5,
  reps_max: 8,
  reps_target: null,
  rpe_target: 9,
  percentage_1rm: 80,
  tempo: null,
  rest_seconds: 180,
  superset_group: null,
  is_warmup: false,
  notes: null,
  set_specs: [{ set_number: 1, set_type: "working", load_type: "pct_1rm", load_value: 80 }],
  video_url: "https://example.com/squat.mp4",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const sourceSession = {
  id: "s1",
  coach_id: "coach-1",
  saved_plan_id: null,
  name: "Leg Day A",
  focus: "legs",
  order_index: 3,
  week_index: 2,
  is_rest: false,
  estimated_duration_minutes: 55,
  calorie_surplus_percentage: 12,
  notes: "note",
  session_type: "training",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  coach_saved_exercises: [exerciseRow],
};

describe("coach-standalone-session-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A bare vi.fn() resolves undefined, which crashes .get() consumers and
    // shifts every mockReturnValueOnce sequence — always give it a Map.
    mockResolveExercises.mockResolvedValue(new Map());
  });

  // =========================================================================
  // createStandaloneSession
  // =========================================================================

  describe("createStandaloneSession", () => {
    it("creates session with saved_plan_id = NULL", async () => {
      const sessionInsertQuery = createMockQuery({ data: { id: "session-1" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionInsertQuery as never;
        if (table === "coach_saved_exercises") return exerciseInsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const sessionId = await createStandaloneSession("coach-1", {
        name: "Quick Workout",
        exercises: [{ name: "Bench Press", sets: 3 }],
      });

      expect(sessionId).toBe("session-1");
      const insertCall = sessionInsertQuery.insert.mock.calls[0][0];
      expect(insertCall.saved_plan_id).toBeNull();
    });

    it("resolves exercise names to catalog IDs", async () => {
      const sessionInsertQuery = createMockQuery({ data: { id: "session-1" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionInsertQuery as never;
        if (table === "coach_saved_exercises") return exerciseInsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await createStandaloneSession("coach-1", {
        name: "Test Session",
        exercises: [
          { name: "Bench Press", sets: 3 },
          { name: "Squat", sets: 4 },
        ],
      });

      expect(mockResolveExercises).toHaveBeenCalledWith(
        ["Bench Press", "Squat"],
        "coach-1"
      );
    });

    it("nulls out exerciseIds that aren't visible to the coach (cross-tenant guard)", async () => {
      const idCheckQuery = createMockQuery({ data: [{ id: "ex-own" }], error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "session-1" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "exercises") return idCheckQuery as never;
        if (table === "coach_saved_sessions") return sessionInsertQuery as never;
        if (table === "coach_saved_exercises") return exerciseInsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await createStandaloneSession("coach-1", {
        name: "Test Session",
        exercises: [
          { name: "Own Exercise", exerciseId: "ex-own", sets: 3 },
          { name: "Foreign Exercise", exerciseId: "ex-foreign", sets: 3 },
        ],
      });

      // Visibility check scoped to own + global rows.
      expect(idCheckQuery.in).toHaveBeenCalledWith("id", ["ex-own", "ex-foreign"]);
      expect(idCheckQuery.or).toHaveBeenCalledWith(
        "coach_id.eq.coach-1,coach_id.is.null"
      );
      // The foreign id fell back to name resolution.
      expect(mockResolveExercises).toHaveBeenCalledWith(
        ["Foreign Exercise"],
        "coach-1"
      );
      // The visible id survived onto the inserted row.
      const rows = exerciseInsertQuery.insert.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(rows[0].exercise_id).toBe("ex-own");
    });

    it("removes the shell session when the exercise insert fails (no orphans)", async () => {
      const sessionQuery = createMockQuery({ data: { id: "session-1" }, error: null });
      const exerciseFailQuery = createMockQuery({
        data: null,
        error: { message: "insert blew up" },
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionQuery as never;
        if (table === "coach_saved_exercises") return exerciseFailQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await expect(
        createStandaloneSession("coach-1", {
          name: "Doomed",
          exercises: [{ name: "Bench Press", sets: 3 }],
        })
      ).rejects.toThrow(/insert blew up/);

      // The just-created session row was compensating-deleted.
      expect(sessionQuery.delete).toHaveBeenCalled();
      expect(sessionQuery.eq).toHaveBeenCalledWith("id", "session-1");
    });
  });

  // =========================================================================
  // createStandaloneSessionDeduped
  // =========================================================================

  describe("createStandaloneSessionDeduped", () => {
    it("keeps a free name verbatim and scopes the name check to standalone rows", async () => {
      const namesQuery = createMockQuery({ data: [{ name: "Other" }], error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "s-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(namesQuery as never)
        .mockReturnValueOnce(sessionInsertQuery as never)
        .mockReturnValueOnce(exerciseInsertQuery as never);

      const result = await createStandaloneSessionDeduped("coach-1", {
        name: "Push Day A",
        exercises: [{ name: "Bench Press", sets: 3 }],
      });

      expect(result).toEqual({ sessionId: "s-new", name: "Push Day A" });
      expect(namesQuery.eq).toHaveBeenCalledWith("coach_id", "coach-1");
      expect(namesQuery.is).toHaveBeenCalledWith("saved_plan_id", null);
      expect(sessionInsertQuery.insert.mock.calls[0][0].name).toBe("Push Day A");
    });

    it("renames case-insensitively on conflict", async () => {
      const namesQuery = createMockQuery({ data: [{ name: "leg day a" }], error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "s-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(namesQuery as never)
        .mockReturnValueOnce(sessionInsertQuery as never)
        .mockReturnValueOnce(exerciseInsertQuery as never);

      const result = await createStandaloneSessionDeduped("coach-1", {
        name: "Leg Day A",
        exercises: [{ name: "Squat", sets: 3 }],
      });

      expect(result.name).toBe("Leg Day A (copy)");
      expect(sessionInsertQuery.insert.mock.calls[0][0].name).toBe("Leg Day A (copy)");
    });

    it("increments to (copy 2) when the (copy) name is taken too", async () => {
      const namesQuery = createMockQuery({
        data: [{ name: "Push Day" }, { name: "Push Day (copy)" }],
        error: null,
      });
      const sessionInsertQuery = createMockQuery({ data: { id: "s-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(namesQuery as never)
        .mockReturnValueOnce(sessionInsertQuery as never)
        .mockReturnValueOnce(exerciseInsertQuery as never);

      const result = await createStandaloneSessionDeduped("coach-1", {
        name: "Push Day",
        exercises: [{ name: "Bench Press", sets: 3 }],
      });

      expect(result.name).toBe("Push Day (copy 2)");
    });

    it("caps the base at 88 chars so the deduped name stays inside the 100-char schema", async () => {
      const longName = "A".repeat(100);
      const namesQuery = createMockQuery({ data: [{ name: longName }], error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "s-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(namesQuery as never)
        .mockReturnValueOnce(sessionInsertQuery as never)
        .mockReturnValueOnce(exerciseInsertQuery as never);

      const result = await createStandaloneSessionDeduped("coach-1", {
        name: longName,
        exercises: [{ name: "Bench Press", sets: 3 }],
      });

      expect(result.name).toBe(`${"A".repeat(88)} (copy)`);
      expect(result.name.length).toBeLessThanOrEqual(100);
    });

    it("carries setSpecs and videoUrl through to the inserted exercise rows", async () => {
      const specs = [
        { set_number: 1, set_type: "warmup", reps_min: 10, reps_max: 10 },
        { set_number: 2, set_type: "working", reps_min: 5, reps_max: 8 },
      ];
      const namesQuery = createMockQuery({ data: [], error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "s-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(namesQuery as never)
        .mockReturnValueOnce(sessionInsertQuery as never)
        .mockReturnValueOnce(exerciseInsertQuery as never);

      await createStandaloneSessionDeduped("coach-1", {
        name: "Specced",
        exercises: [
          {
            name: "Bench Press",
            sets: 3,
            setSpecs: specs as never,
            videoUrl: "https://example.com/bench.mp4",
          },
        ],
      });

      const rows = exerciseInsertQuery.insert.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(rows[0].set_specs).toEqual(specs);
      expect(rows[0].video_url).toBe("https://example.com/bench.mp4");
    });
  });

  // =========================================================================
  // getStandaloneSessions
  // =========================================================================

  describe("getStandaloneSessions", () => {
    it("fetches sessions where saved_plan_id is null", async () => {
      const sessionsQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(sessionsQuery as never);

      await getStandaloneSessions("coach-1");

      expect(mockFrom).toHaveBeenCalledWith("coach_saved_sessions");
      expect(sessionsQuery.eq).toHaveBeenCalledWith("coach_id", "coach-1");
      expect(sessionsQuery.is).toHaveBeenCalledWith("saved_plan_id", null);
    });
  });

  // =========================================================================
  // overwriteStandaloneSession
  // =========================================================================

  describe("overwriteStandaloneSession", () => {
    it("swaps children then updates fields, re-projecting compact columns from setSpecs", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      const idCheckQuery = createMockQuery({ data: [{ id: "ex-own" }], error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: null, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(snapshotQuery as never)
        .mockReturnValueOnce(idCheckQuery as never)
        .mockReturnValueOnce(deleteQuery as never)
        .mockReturnValueOnce(insertQuery as never)
        .mockReturnValueOnce(updateQuery as never);

      mockResolveExercises.mockResolvedValue(new Map([["flye", "ex-flye"]]));

      const specs = [
        { set_number: 1, set_type: "warmup", reps_min: 10, reps_max: 10 },
        { set_number: 2, set_type: "working", reps_min: 5, reps_max: 5 },
        { set_number: 3, set_type: "working", reps_min: 8, reps_max: 10 },
      ];
      await overwriteStandaloneSession("s1", "coach-1", {
        name: "Push Day v2",
        focus: "chest",
        estimatedDurationMinutes: 45,
        calorieSurplusPercentage: 10,
        exercises: [
          {
            name: "Bench Press",
            exerciseId: "ex-own",
            sets: 3,
            setSpecs: specs as never,
            videoUrl: "https://example.com/bench.mp4",
          },
          { name: "Flye", sets: 3 },
        ],
      });

      // Snapshot is ownership + standalone scope in one query.
      expect(snapshotQuery.eq).toHaveBeenCalledWith("id", "s1");
      expect(snapshotQuery.eq).toHaveBeenCalledWith("coach_id", "coach-1");
      expect(snapshotQuery.is).toHaveBeenCalledWith("saved_plan_id", null);

      // Old children removed by session scope.
      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(deleteQuery.eq).toHaveBeenCalledWith("saved_session_id", "s1");

      const rows = insertQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      // set_specs/video_url verbatim; compact columns RE-PROJECTED from the
      // specs (2 working sets, reps spanning 5..10), not the raw input.
      expect(rows[0].set_specs).toEqual(specs);
      expect(rows[0].video_url).toBe("https://example.com/bench.mp4");
      expect(rows[0].sets).toBe(2);
      expect(rows[0].reps_min).toBe(5);
      expect(rows[0].reps_max).toBe(10);
      expect(rows[0].exercise_id).toBe("ex-own");
      expect(rows[0].order_index).toBe(0);
      expect(rows[1].exercise_id).toBe("ex-flye");
      expect(rows[1].order_index).toBe(1);

      // Field update is full-replace with explicit nulls + canonical indices.
      expect(updateQuery.update).toHaveBeenCalledWith({
        name: "Push Day v2",
        focus: "chest",
        estimated_duration_minutes: 45,
        calorie_surplus_percentage: 10,
        notes: null,
        order_index: 0,
        week_index: 0,
        is_rest: false,
      });
      expect(updateQuery.eq).toHaveBeenCalledWith("id", "s1");
      expect(updateQuery.eq).toHaveBeenCalledWith("coach_id", "coach-1");
    });

    it("rejects plan-attached or foreign sessions before any destructive write", async () => {
      const snapshotQuery = createMockQuery({ data: null, error: { message: "0 rows" } });
      mockFrom.mockReturnValueOnce(snapshotQuery as never);

      await expect(
        overwriteStandaloneSession("s1", "coach-1", { name: "X", exercises: [] })
      ).rejects.toThrow("Session not found");
      // No delete was ever issued.
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it("nulls a foreign exerciseId and falls back to name resolution", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      const idCheckQuery = createMockQuery({ data: [], error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: null, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(snapshotQuery as never)
        .mockReturnValueOnce(idCheckQuery as never)
        .mockReturnValueOnce(deleteQuery as never)
        .mockReturnValueOnce(insertQuery as never)
        .mockReturnValueOnce(updateQuery as never);

      mockResolveExercises.mockResolvedValue(new Map([["foreign", "ex-resolved"]]));

      await overwriteStandaloneSession("s1", "coach-1", {
        name: "X",
        exercises: [{ name: "Foreign", exerciseId: "ex-foreign", sets: 3 }],
      });

      expect(mockResolveExercises).toHaveBeenCalledWith(["Foreign"], "coach-1");
      const rows = insertQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(rows[0].exercise_id).toBe("ex-resolved");
    });

    it("restores the snapshot children when the new insert fails", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });
      const insertFailQuery = createMockQuery({
        data: null,
        error: { message: "insert blew up" },
      });
      const restoreQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(snapshotQuery as never)
        .mockReturnValueOnce(deleteQuery as never)
        .mockReturnValueOnce(insertFailQuery as never)
        .mockReturnValueOnce(restoreQuery as never);

      await expect(
        overwriteStandaloneSession("s1", "coach-1", {
          name: "X",
          exercises: [{ name: "Bench Press", sets: 3 }],
        })
      ).rejects.toThrow(/insert blew up/);

      // The restore re-inserted the pre-call children verbatim.
      const restored = restoreQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(restored[0].saved_session_id).toBe("s1");
      expect(restored[0].exercise_id).toBe("ex-3");
      expect(restored[0].set_specs).toEqual(exerciseRow.set_specs);
    });

    it("combines both errors when the restore itself fails (root cause never shadowed)", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });
      const insertFailQuery = createMockQuery({
        data: null,
        error: { message: "insert blew up" },
      });
      const restoreFailQuery = createMockQuery({
        data: null,
        error: { message: "restore boom" },
      });

      mockFrom
        .mockReturnValueOnce(snapshotQuery as never)
        .mockReturnValueOnce(deleteQuery as never)
        .mockReturnValueOnce(insertFailQuery as never)
        .mockReturnValueOnce(restoreFailQuery as never);

      await expect(
        overwriteStandaloneSession("s1", "coach-1", {
          name: "X",
          exercises: [{ name: "Bench Press", sets: 3 }],
        })
      ).rejects.toThrow(
        /insert blew up.*restore also failed: restore boom/
      );
    });

    it("throws before any delete when name resolution fails", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      mockFrom.mockReturnValueOnce(snapshotQuery as never);
      mockResolveExercises.mockRejectedValueOnce(new Error("resolve boom"));

      await expect(
        overwriteStandaloneSession("s1", "coach-1", {
          name: "X",
          exercises: [{ name: "Bench Press", sets: 3 }],
        })
      ).rejects.toThrow("resolve boom");

      // Only the snapshot select ran — children untouched.
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it("accepts an empty exercise list (delete children, still update fields)", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(snapshotQuery as never)
        .mockReturnValueOnce(deleteQuery as never)
        .mockReturnValueOnce(updateQuery as never);

      await overwriteStandaloneSession("s1", "coach-1", {
        name: "Emptied",
        exercises: [],
      });

      // insertSavedExercises early-returns on [] — exactly 3 queries ran.
      expect(mockFrom).toHaveBeenCalledTimes(3);
      expect(deleteQuery.delete).toHaveBeenCalled();
      expect(updateQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Emptied" })
      );
    });

    it("unwinds the child swap when the final field update fails", async () => {
      const snapshotQuery = createMockQuery({ data: sourceSession, error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: null, error: null });
      const updateFailQuery = createMockQuery({
        data: null,
        error: { message: "upd boom" },
      });
      const unwindDeleteQuery = createMockQuery({ data: null, error: null });
      const restoreQuery = createMockQuery({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(snapshotQuery as never)
        .mockReturnValueOnce(deleteQuery as never)
        .mockReturnValueOnce(insertQuery as never)
        .mockReturnValueOnce(updateFailQuery as never)
        .mockReturnValueOnce(unwindDeleteQuery as never)
        .mockReturnValueOnce(restoreQuery as never);

      await expect(
        overwriteStandaloneSession("s1", "coach-1", {
          name: "X",
          exercises: [{ name: "Bench Press", sets: 3 }],
        })
      ).rejects.toThrow("Failed to update session: upd boom");

      // The just-inserted children were removed and the snapshot restored —
      // the session is byte-identical to its pre-call state.
      expect(unwindDeleteQuery.delete).toHaveBeenCalled();
      expect(unwindDeleteQuery.eq).toHaveBeenCalledWith("saved_session_id", "s1");
      const restored = restoreQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(restored[0].exercise_id).toBe("ex-3");
      expect(restored[0].set_specs).toEqual(exerciseRow.set_specs);
    });
  });
});
