import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Collaborators are mocked so this file tests THIS service's resolution, not
// theirs. All three also read training_plans, which would otherwise collide with
// the plan query's mock.
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));
vi.mock("./training-service", () => ({
  getNextFutureTrainingPlan: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTrainingPlan } from "./client-training-plan-service";
import { getClientTodayString } from "./today-service";
import { getNextFutureTrainingPlan } from "./training-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const CLIENT_ID = "client-1";
const TODAY = "2026-07-27";

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
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
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
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
    vi.mocked(getNextFutureTrainingPlan).mockResolvedValue(null);
  });

  /** plan → sessions → exercises, dispatched by table. */
  function mockTables(opts: {
    plan: unknown;
    sessions?: unknown[];
    exercises?: unknown[];
  }) {
    const planQuery = awaitableQuery({ data: opts.plan, error: null });
    const sessionsQuery = awaitableQuery({ data: opts.sessions ?? [], error: null });
    const exercisesQuery = awaitableQuery({ data: opts.exercises ?? [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return planQuery as never;
      if (table === "training_sessions") return sessionsQuery as never;
      if (table === "training_exercises") return exercisesQuery as never;
      throw new Error(`Unexpected from(): ${table}`);
    });
    return { planQuery, sessionsQuery, exercisesQuery };
  }

  it("returns null when no active training plan exists for the client", async () => {
    const planQuery = awaitableQuery({ data: null, error: null });
    mockFrom.mockReturnValue(
      planQuery as unknown as ReturnType<typeof supabaseAdmin.from>
    );

    const result = await getClientTrainingPlan(CLIENT_ID);

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith("training_plans");
  });

  // These pin the RESOLUTION PREDICATE, which nothing covered before: the reader
  // used to take the newest-CREATED active row with no end date, which answered a
  // different question from the coach side and let a queued program title the
  // client's Program tab.
  describe("resolution predicate", () => {
    it("filters by date window and status='active', ordered newest-start first", async () => {
      const { planQuery } = mockTables({ plan: null });

      await getClientTrainingPlan(CLIENT_ID);

      expect(planQuery.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
      expect(planQuery.eq).toHaveBeenCalledWith("status", "active");
      expect(planQuery.is).toHaveBeenCalledWith("deleted_at", null);
      expect(planQuery.lte).toHaveBeenCalledWith("effective_from", TODAY);
      expect(planQuery.gte).toHaveBeenCalledWith("effective_until", TODAY);
      expect(planQuery.order).toHaveBeenCalledWith("effective_from", { ascending: false });
      expect(planQuery.order).toHaveBeenCalledWith("created_at", { ascending: false });
    });

    it("reads both ends off the row — no open-window arm (migration 167)", async () => {
      const { planQuery } = mockTables({ plan: null });

      await getClientTrainingPlan(CLIENT_ID);

      expect(planQuery.gte).toHaveBeenCalledWith("effective_until", TODAY);
      expect(planQuery.is).not.toHaveBeenCalledWith("effective_until", null);
    });

    it("resolves against the CLIENT's today, not the server's", async () => {
      vi.mocked(getClientTodayString).mockResolvedValue("2026-03-04");
      const { planQuery } = mockTables({ plan: null });

      await getClientTrainingPlan(CLIENT_ID);

      expect(getClientTodayString).toHaveBeenCalledWith(CLIENT_ID);
      expect(planQuery.lte).toHaveBeenCalledWith("effective_from", "2026-03-04");
    });
  });

  describe("lifecycle state", () => {
    const started = {
      id: "plan-1",
      name: "Running",
      effective_from: "2026-07-01",
      effective_until: "2026-08-11",
    };

    it("labels a program whose window covers today as active", async () => {
            mockTables({ plan: { ...started, effective_until: "2026-08-11" } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({
        planId: "plan-1",
        state: "active",
        startsOn: "2026-07-01",
        endsOn: "2026-08-11",
      });
      expect(getNextFutureTrainingPlan).not.toHaveBeenCalled();
    });

    it("labels a program whose last day has passed as ended", async () => {
            mockTables({ plan: { ...started, effective_until: "2026-07-26" } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({ planId: "plan-1", state: "ended", endsOn: "2026-07-26" });
    });

    it("stays active on the program's final day (boundary is inclusive)", async () => {
            mockTables({ plan: { ...started, effective_until: TODAY } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result!.state).toBe("active");
    });

    it("returns a not-yet-started program as upcoming rather than current", async () => {
      vi.mocked(getNextFutureTrainingPlan).mockResolvedValue({
        id: "plan-2",
        name: "Next block",
        effectiveFrom: "2026-08-17",
        effectiveUntil: "2026-09-13",
        splitType: "ppl",
        frequencyPerWeek: 4,
        programDurationWeeks: 4,
      });
      mockTables({ plan: null });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({
        planId: "plan-2",
        state: "upcoming",
        startsOn: "2026-08-17",
        endsOn: "2026-09-13",
      });
    });

    it("prefers a queued program over an ended one — live information beats history", async () => {
      vi.mocked(getNextFutureTrainingPlan).mockResolvedValue({
        id: "plan-2",
        name: "Next block",
        effectiveFrom: "2026-08-17",
        effectiveUntil: "2026-09-13",
        splitType: "ppl",
        frequencyPerWeek: 4,
        programDurationWeeks: 4,
      });
      mockTables({ plan: { ...started, effective_until: "2026-07-20" } });

      const result = await getClientTrainingPlan(CLIENT_ID);

      expect(result).toMatchObject({ planId: "plan-2", state: "upcoming" });
    });

    it("reads the end from the row, never from the slot count", async () => {
      mockTables({
        plan: started,
        sessions: [
          { id: "s0", name: "Push", focus: null, order_index: 0, week_index: 0, is_rest: false, estimated_duration_minutes: null },
          { id: "s1", name: "Rest", focus: null, order_index: 1, week_index: 0, is_rest: true, estimated_duration_minutes: null },
        ],
      });

      const result = await getClientTrainingPlan(CLIENT_ID);

      // Two slot rows would have read as a two-day program under the old
      // derivation; the row says six weeks (migration 167), and the row wins.
      expect(result!.endsOn).toBe("2026-08-11");
    });
  });

  it("returns the plan's sessions with their exercises", async () => {
    const planRow = {
      id: "plan-1",
      name: "My Plan",
      effective_from: "2026-07-01",
      effective_until: "2026-08-11",
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
    const planRow = { id: "plan-1", name: "New PPL", effective_from: "2026-07-01" };
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
    const planRow = { id: "plan-1", name: "3-week", effective_from: "2026-07-01" };
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
