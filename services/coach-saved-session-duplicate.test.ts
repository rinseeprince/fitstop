import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn(),
}));

function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
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
import { duplicateStandaloneSession } from "./coach-saved-session-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

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

describe("duplicateStandaloneSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies the session + exercises verbatim with a deduped name", async () => {
    const sourceQuery = createMockQuery({ data: sourceSession, error: null });
    const namesQuery = createMockQuery({
      data: [{ name: "Leg Day A" }],
      error: null,
    });
    const insertQuery = createMockQuery({ data: { id: "s2" }, error: null });
    const exerciseInsertQuery = createMockQuery({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(sourceQuery as never)
      .mockReturnValueOnce(namesQuery as never)
      .mockReturnValueOnce(insertQuery as never)
      .mockReturnValueOnce(exerciseInsertQuery as never);

    const newId = await duplicateStandaloneSession("s1", "coach-1");
    expect(newId).toBe("s2");

    // Source fetch is scoped to standalone sessions only
    expect(sourceQuery.is).toHaveBeenCalledWith("saved_plan_id", null);

    const sessionInsert = insertQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(sessionInsert.name).toBe("Leg Day A (copy)");
    expect(sessionInsert.saved_plan_id).toBeNull();
    expect(sessionInsert.calorie_surplus_percentage).toBe(12);
    // Placement indices normalized — a stale week_index would leak into
    // plans on insert.
    expect(sessionInsert.week_index).toBe(0);
    expect(sessionInsert.order_index).toBe(0);

    const exRows = exerciseInsertQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(exRows).toHaveLength(1);
    expect(exRows[0].saved_session_id).toBe("s2");
    expect(exRows[0].exercise_id).toBe("ex-3");
    expect(exRows[0].set_specs).toEqual(exerciseRow.set_specs);
    expect(exRows[0].video_url).toBe(exerciseRow.video_url);
  });

  it("rejects plan-attached or foreign sessions", async () => {
    // A plan-attached session never matches the .is(saved_plan_id, null)
    // filter, so the source fetch returns no row.
    const sourceQuery = createMockQuery({ data: null, error: { message: "0 rows" } });
    mockFrom.mockReturnValueOnce(sourceQuery as never);

    await expect(duplicateStandaloneSession("s1", "coach-1")).rejects.toThrow(
      "Session not found"
    );
  });

  it("removes the half-copied session when the exercise copy fails", async () => {
    const sourceQuery = createMockQuery({ data: sourceSession, error: null });
    const namesQuery = createMockQuery({ data: [], error: null });
    const insertQuery = createMockQuery({ data: { id: "s2" }, error: null });
    const exerciseFailQuery = createMockQuery({
      data: null,
      error: { message: "boom" },
    });
    const cleanupQuery = createMockQuery({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(sourceQuery as never)
      .mockReturnValueOnce(namesQuery as never)
      .mockReturnValueOnce(insertQuery as never)
      .mockReturnValueOnce(exerciseFailQuery as never)
      .mockReturnValueOnce(cleanupQuery as never);

    await expect(duplicateStandaloneSession("s1", "coach-1")).rejects.toThrow(
      "Failed to copy exercises: boom"
    );
    expect(cleanupQuery.delete).toHaveBeenCalled();
    expect(cleanupQuery.eq).toHaveBeenCalledWith("id", "s2");
  });
});
