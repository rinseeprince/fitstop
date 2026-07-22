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

  it("returns the plan's sessions with their exercises", async () => {
    const planRow = {
      id: "plan-1",
      name: "My Plan",
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
    expect(result!.planName).toBe("My Plan");
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
    // The plan describes itself — the library template is never consulted.
    expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
  });

  it("returns real is_rest rows inline", async () => {
    const planRow = { id: "plan-1", name: "New PPL" };
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

    expect(result!.sessions.map((s) => s.name)).toEqual(["Push", "Rest", "Legs"]);
    expect(result!.sessions[1].isRest).toBe(true);
    expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
  });

  it("returns multi-week (week_index > 0) entries inline", async () => {
    const planRow = { id: "plan-1", name: "3-week" };
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

    expect(result!.sessions.map((s) => s.weekIndex)).toEqual([0, 1]);
    expect(mockFrom).not.toHaveBeenCalledWith("coach_saved_plans");
  });
});
