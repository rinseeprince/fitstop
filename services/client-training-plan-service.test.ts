import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTrainingPlan } from "./client-training-plan-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const CLIENT_ID = "client-1";

type MockResult<T> = { data: T | null; error: { message: string } | null };

function awaitableQuery<T>(result: MockResult<T>) {
  const q: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // Paged reads (lib/paged-fetch) call .range(); the fetcher stops when a page
    // comes back short, and this mock resolves the same result for any range, so
    // one short page ends the loop.
    range: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (value: MockResult<T>) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return q;
}

describe("client-training-plan-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no active training plan exists for the client", async () => {
    const planQuery = awaitableQuery({ data: null, error: null });
    mockFrom.mockReturnValue(
      planQuery as unknown as ReturnType<typeof supabaseAdmin.from>
    );

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith("training_plans");
  });

  it("returns flat sessions with empty rest pattern when saved_plan_id is null", async () => {
    const planRow = {
      id: "plan-1",
      name: "My AI Plan",
      saved_plan_id: null,
    };
    const sessionRows = [
      {
        id: "session-1",
        name: "Push",
        focus: "Chest",
        order_index: 0,
        estimated_duration_minutes: 60,
      },
      {
        id: "session-2",
        name: "Pull",
        focus: "Back",
        order_index: 1,
        estimated_duration_minutes: 60,
      },
    ];
    const exerciseRows = [
      {
        id: "ex-1",
        session_id: "session-1",
        name: "Bench",
        order_index: 0,
        sets: 4,
        reps_min: 8,
        reps_max: 10,
        reps_target: null,
        rpe_target: 8,
        tempo: null,
        rest_seconds: 120,
        is_warmup: false,
        superset_group: null,
      },
    ];

    const planQuery = awaitableQuery({ data: planRow, error: null });
    const sessionsQuery = awaitableQuery({ data: sessionRows, error: null });
    const exercisesQuery = awaitableQuery({ data: exerciseRows, error: null });

    let call = 0;
    mockFrom.mockImplementation((table: string) => {
      call++;
      if (table === "training_plans") return planQuery as never;
      if (table === "training_sessions") return sessionsQuery as never;
      if (table === "training_exercises") return exercisesQuery as never;
      throw new Error(`Unexpected from(): ${table} (call ${call})`);
    });

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.planId).toBe("plan-1");
    expect(result!.planName).toBe("My AI Plan");
    expect(result!.cycleLength).toBe(2);
    expect(result!.restPattern).toEqual([]);
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions[0]).toMatchObject({
      id: "session-1",
      name: "Push",
      isRest: false,
      orderIndex: 0,
    });
    expect(result!.sessions[0].exercises).toHaveLength(1);
    expect(result!.sessions[0].exercises[0]).toMatchObject({
      name: "Bench",
      sets: 4,
      repsMin: 8,
      repsMax: 10,
      rpeTarget: 8,
    });
    expect(result!.sessions[1].exercises).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
  });

  it("splices synthetic rest entries when saved_plan_id + cycle metadata are populated", async () => {
    const planRow = {
      id: "plan-1",
      name: "PPL+Rest",
      saved_plan_id: "saved-1",
    };
    const sessionRows = [
      {
        id: "session-0",
        name: "Push",
        focus: "Chest",
        order_index: 0,
        estimated_duration_minutes: 60,
      },
      {
        id: "session-1",
        name: "Pull",
        focus: "Back",
        order_index: 1,
        estimated_duration_minutes: 60,
      },
      {
        id: "session-3",
        name: "Legs",
        focus: "Quads",
        order_index: 3,
        estimated_duration_minutes: 70,
      },
    ];
    const savedPlanRow = {
      cycle_length: 5,
      rest_pattern: [2, 4],
    };

    const planQuery = awaitableQuery({ data: planRow, error: null });
    const sessionsQuery = awaitableQuery({ data: sessionRows, error: null });
    const exercisesQuery = awaitableQuery({ data: [], error: null });
    const savedPlanQuery = awaitableQuery({ data: savedPlanRow, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return planQuery as never;
      if (table === "training_sessions") return sessionsQuery as never;
      if (table === "training_exercises") return exercisesQuery as never;
      if (table === "coach_saved_plans") return savedPlanQuery as never;
      throw new Error(`Unexpected from(): ${table}`);
    });

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.cycleLength).toBe(5);
    expect(result!.restPattern).toEqual([2, 4]);
    expect(result!.sessions).toHaveLength(5);
    expect(result!.sessions.map((s) => s.name)).toEqual([
      "Push",
      "Pull",
      "Rest",
      "Legs",
      "Rest",
    ]);
    expect(result!.sessions[2].isRest).toBe(true);
    expect(result!.sessions[2].id).toBe("rest-2");
    expect(result!.sessions[4].isRest).toBe(true);
    expect(result!.sessions[4].id).toBe("rest-4");
    expect(result!.sessions[0].isRest).toBe(false);
    expect(result!.sessions[3].isRest).toBe(false);
  });

  it("falls back to flat sessions when saved_plan row has null cycle_length", async () => {
    const planRow = {
      id: "plan-1",
      name: "Stale-Linked Plan",
      saved_plan_id: "saved-1",
    };
    const sessionRows = [
      {
        id: "session-0",
        name: "Push",
        focus: null,
        order_index: 0,
        estimated_duration_minutes: null,
      },
      {
        id: "session-1",
        name: "Pull",
        focus: null,
        order_index: 1,
        estimated_duration_minutes: null,
      },
    ];
    const savedPlanRow = {
      cycle_length: null,
      rest_pattern: null,
    };

    const planQuery = awaitableQuery({ data: planRow, error: null });
    const sessionsQuery = awaitableQuery({ data: sessionRows, error: null });
    const exercisesQuery = awaitableQuery({ data: [], error: null });
    const savedPlanQuery = awaitableQuery({ data: savedPlanRow, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return planQuery as never;
      if (table === "training_sessions") return sessionsQuery as never;
      if (table === "training_exercises") return exercisesQuery as never;
      if (table === "coach_saved_plans") return savedPlanQuery as never;
      throw new Error(`Unexpected from(): ${table}`);
    });

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.cycleLength).toBe(2);
    expect(result!.restPattern).toEqual([]);
    expect(result!.sessions).toHaveLength(2);
    expect(result!.sessions.every((s) => !s.isRest)).toBe(true);
  });

  it("self-describing: real is_rest rows render inline without joining the template (migration 121)", async () => {
    const planRow = { id: "plan-1", name: "New PPL", saved_plan_id: "saved-1" };
    const sessionRows = [
      { id: "s0", name: "Push", focus: "Chest", order_index: 0, week_index: 0, is_rest: false, estimated_duration_minutes: 60 },
      { id: "s1", name: "Rest", focus: null, order_index: 1, week_index: 0, is_rest: true, estimated_duration_minutes: null },
      { id: "s2", name: "Legs", focus: "Quads", order_index: 2, week_index: 0, is_rest: false, estimated_duration_minutes: 60 },
    ];
    const planQuery = awaitableQuery({ data: planRow, error: null });
    const sessionsQuery = awaitableQuery({ data: sessionRows, error: null });
    const exercisesQuery = awaitableQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return planQuery as never;
      if (table === "training_sessions") return sessionsQuery as never;
      if (table === "training_exercises") return exercisesQuery as never;
      throw new Error(`Unexpected from(): ${table}`);
    });

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result!.cycleLength).toBe(3);
    expect(result!.restPattern).toEqual([1]);
    expect(result!.sessions.map((s) => s.name)).toEqual(["Push", "Rest", "Legs"]);
    expect(result!.sessions[1].isRest).toBe(true);
    // Self-describing: the library template is never consulted.
    expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
  });

  it("self-describing: multi-week (week_index > 0) renders inline without a template join", async () => {
    const planRow = { id: "plan-1", name: "3-week", saved_plan_id: "saved-1" };
    const sessionRows = [
      { id: "w0", name: "Week1 Day1", focus: null, order_index: 0, week_index: 0, is_rest: false, estimated_duration_minutes: null },
      { id: "w1", name: "Week2 Day1", focus: null, order_index: 0, week_index: 1, is_rest: false, estimated_duration_minutes: null },
    ];
    const planQuery = awaitableQuery({ data: planRow, error: null });
    const sessionsQuery = awaitableQuery({ data: sessionRows, error: null });
    const exercisesQuery = awaitableQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return planQuery as never;
      if (table === "training_sessions") return sessionsQuery as never;
      if (table === "training_exercises") return exercisesQuery as never;
      throw new Error(`Unexpected from(): ${table}`);
    });

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result!.cycleLength).toBe(2);
    expect(result!.restPattern).toEqual([]);
    expect(result!.sessions.map((s) => s.weekIndex)).toEqual([0, 1]);
    expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
  });
});
