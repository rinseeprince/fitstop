import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Chainable query mock (coach-library.test.ts pattern) + .not/.range for the
// assignments query.
function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
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
import {
  duplicateSavedPlan,
  getSavedPlanAssignments,
} from "./coach-saved-plan-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const exerciseRow = {
  id: "e1",
  saved_session_id: "s1",
  exercise_id: "ex-9",
  name: "Bench Press",
  order_index: 0,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  reps_target: null,
  rpe_target: 8,
  percentage_1rm: null,
  tempo: "31X0",
  rest_seconds: 120,
  superset_group: "A",
  is_warmup: false,
  notes: "coach note",
  set_specs: [
    { set_number: 1, set_type: "warmup", reps_min: 10 },
    { set_number: 2, set_type: "working", reps_min: 8, reps_max: 12 },
  ],
  video_url: "https://example.com/bench.mp4",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const sourcePlan = {
  id: "plan-1",
  coach_id: "coach-1",
  name: "My Plan",
  description: "desc",
  split_type: "push_pull_legs",
  frequency_per_week: 3,
  status: "draft",
  default_surplus_percentage: 15,
  source: "ai",
  coach_prompt: "prompt",
  program_duration_weeks: 2,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  coach_saved_sessions: [
    {
      id: "s1",
      coach_id: "coach-1",
      saved_plan_id: "plan-1",
      name: "Push",
      focus: "chest",
      order_index: 0,
      week_index: 0,
      is_rest: false,
      estimated_duration_minutes: 60,
      calorie_surplus_percentage: 10,
      notes: null,
      session_type: "training",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      coach_saved_exercises: [exerciseRow],
    },
    {
      id: "s2",
      coach_id: "coach-1",
      saved_plan_id: "plan-1",
      name: "Rest",
      focus: null,
      order_index: 1,
      week_index: 0,
      is_rest: true,
      estimated_duration_minutes: null,
      calorie_surplus_percentage: null,
      notes: null,
      session_type: "training",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      coach_saved_exercises: [],
    },
  ],
};

describe("duplicateSavedPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deep-copies plan, sessions, and exercises verbatim with a deduped name", async () => {
    const sourceQuery = createMockQuery({ data: sourcePlan, error: null });
    const namesQuery = createMockQuery({
      data: [{ name: "My Plan" }, { name: "My Plan (copy)" }],
      error: null,
    });
    const planInsertQuery = createMockQuery({ data: { id: "plan-2" }, error: null });
    const session1InsertQuery = createMockQuery({ data: { id: "ns1" }, error: null });
    const session2InsertQuery = createMockQuery({ data: { id: "ns2" }, error: null });
    const exerciseInsertQuery = createMockQuery({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(sourceQuery as never)
      .mockReturnValueOnce(namesQuery as never)
      .mockReturnValueOnce(planInsertQuery as never)
      .mockReturnValueOnce(session1InsertQuery as never)
      .mockReturnValueOnce(session2InsertQuery as never)
      .mockReturnValueOnce(exerciseInsertQuery as never);

    const newId = await duplicateSavedPlan("plan-1", "coach-1");
    expect(newId).toBe("plan-2");

    // Name deduped past the existing "(copy)"
    const planInsert = planInsertQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(planInsert.name).toBe("My Plan (copy 2)");
    // Status + source copied as-is (duplicating a draft yields a draft)
    expect(planInsert.status).toBe("draft");
    expect(planInsert.source).toBe("ai");
    expect(planInsert.default_surplus_percentage).toBe(15);
    expect(planInsert.program_duration_weeks).toBe(2);

    // Session rows carry week/order/rest/surplus
    const s1Insert = session1InsertQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(s1Insert.saved_plan_id).toBe("plan-2");
    expect(s1Insert.calorie_surplus_percentage).toBe(10);
    const s2Insert = session2InsertQuery.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(s2Insert.is_rest).toBe(true);

    // Exercise rows copied verbatim: set_specs, video_url, exercise_id intact
    const exRows = exerciseInsertQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(exRows).toHaveLength(1);
    expect(exRows[0].saved_session_id).toBe("ns1");
    expect(exRows[0].exercise_id).toBe("ex-9");
    expect(exRows[0].set_specs).toEqual(exerciseRow.set_specs);
    expect(exRows[0].video_url).toBe(exerciseRow.video_url);
    expect(exRows[0].superset_group).toBe("A");
  });

  it("throws Plan not found for a foreign or missing plan", async () => {
    const sourceQuery = createMockQuery({ data: null, error: { message: "0 rows" } });
    mockFrom.mockReturnValueOnce(sourceQuery as never);

    await expect(duplicateSavedPlan("plan-x", "coach-1")).rejects.toThrow(
      "Plan not found"
    );
  });

  it("cleans up the new plan row when a child copy fails", async () => {
    const sourceQuery = createMockQuery({ data: sourcePlan, error: null });
    const namesQuery = createMockQuery({ data: [], error: null });
    const planInsertQuery = createMockQuery({ data: { id: "plan-2" }, error: null });
    const sessionFailQuery = createMockQuery({
      data: null,
      error: { message: "boom" },
    });
    const cleanupQuery = createMockQuery({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(sourceQuery as never)
      .mockReturnValueOnce(namesQuery as never)
      .mockReturnValueOnce(planInsertQuery as never)
      .mockReturnValueOnce(sessionFailQuery as never)
      .mockReturnValueOnce(cleanupQuery as never);

    await expect(duplicateSavedPlan("plan-1", "coach-1")).rejects.toThrow(
      'Failed to copy session "Push"'
    );
    expect(cleanupQuery.delete).toHaveBeenCalled();
    expect(cleanupQuery.eq).toHaveBeenCalledWith("id", "plan-2");
  });
});

describe("getSavedPlanAssignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts live assignments per plan and distinct clients", async () => {
    const query = createMockQuery({
      data: [
        { saved_plan_id: "plan-1", client_id: "c1" },
        { saved_plan_id: "plan-1", client_id: "c2" },
        { saved_plan_id: "plan-2", client_id: "c1" },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(query as never);

    const result = await getSavedPlanAssignments("coach-1");

    expect(query.eq).toHaveBeenCalledWith("coach_id", "coach-1");
    expect(query.not).toHaveBeenCalledWith("saved_plan_id", "is", null);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.in).toHaveBeenCalledWith("status", ["active", "planned"]);

    expect(result.totalAssignments).toBe(3);
    expect(result.distinctClients).toBe(2);
    expect(result.perPlan).toContainEqual({ savedPlanId: "plan-1", count: 2 });
    expect(result.perPlan).toContainEqual({ savedPlanId: "plan-2", count: 1 });
  });

  it("propagates query errors", async () => {
    const query = createMockQuery({ data: null, error: { message: "db down" } });
    mockFrom.mockReturnValueOnce(query as never);

    await expect(getSavedPlanAssignments("coach-1")).rejects.toThrow(
      "Failed to fetch plan assignments: db down"
    );
  });
});
