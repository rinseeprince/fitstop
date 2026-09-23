import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

// The next-plan cap is stubbed for the placement-time reads that still ask it.
vi.mock("./training-event-service", () => ({
  getNextPlanStartCap: vi.fn().mockResolvedValue(null),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import {
  createTrainingPlanAtomic,
  getActiveTrainingPlanId,
  getFurthestLiveProgramEnd,
  getNextFutureTrainingPlan,
  getTrainingPlanForDate,
  getTrainingPlanIdForDate,
  getTrainingPlansOverlapping,
  getLiveProgramWindowsForClients,
} from "./training-service";

describe("createTrainingPlanAtomic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: "plan-123",
      error: null,
    } as never);
  });

  it("passes the client-local today to the RPC as p_today", async () => {
    // London client at 00:30 BST: server UTC is still 2026-06-09 — the RPC
    // must judge active-vs-planned against the client's 06-10, not UTC.
    const planId = await createTrainingPlanAtomic({
      clientId: "client-1",
      coachId: "coach-1",
      name: "PPL",
      coachPrompt: "",
      splitType: "ppl",
      frequencyPerWeek: 3,
      effectiveFrom: "2026-06-10",
    });

    expect(planId).toBe("plan-123");
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "create_training_plan_atomic",
      expect.objectContaining({
        p_client_id: "client-1",
        p_effective_from: "2026-06-10",
        p_today: "2026-06-10",
      }),
    );
  });

  it("always computes p_today even when no effectiveFrom is given", async () => {
    await createTrainingPlanAtomic({
      clientId: "client-1",
      coachId: "coach-1",
      name: "PPL",
      coachPrompt: "",
      splitType: "ppl",
      frequencyPerWeek: 3,
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "create_training_plan_atomic",
      expect.objectContaining({
        p_effective_from: null,
        p_today: "2026-06-10",
      }),
    );
  });

  it("throws when the RPC errors", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "boom" },
    } as never);

    await expect(
      createTrainingPlanAtomic({
        clientId: "client-1",
        coachId: "coach-1",
        name: "PPL",
        coachPrompt: "",
        splitType: "ppl",
        frequencyPerWeek: 3,
      }),
    ).rejects.toThrow("Failed to create training plan atomically: boom");
  });
});

describe("date-driven plan resolution", () => {
  function createIdQuery(result: { data: unknown; error: unknown }) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getTrainingPlanIdForDate resolves the plan whose range covers the given date", async () => {
    const q = createIdQuery({ data: { id: "plan-cover" }, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    const id = await getTrainingPlanIdForDate("client-1", "2026-06-15");

    expect(id).toBe("plan-cover");
    // Window predicate: effective_from <= date, ordered effective_from DESC.
    expect(q.lte).toHaveBeenCalledWith("effective_from", "2026-06-15");
  });

  it("getTrainingPlanIdForDate returns null (not a throw) when no plan covers the date", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      createIdQuery({ data: null, error: null }) as never,
    );

    expect(await getTrainingPlanIdForDate("client-1", "2026-06-15")).toBeNull();
  });

  it("getActiveTrainingPlanId resolves against the client-local today", async () => {
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");
    const q = createIdQuery({ data: { id: "plan-today" }, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    const id = await getActiveTrainingPlanId("client-1");

    expect(id).toBe("plan-today");
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(q.lte).toHaveBeenCalledWith("effective_from", "2026-06-10");
  });

  // The regression this function exists to prevent: "Delete training plan"
  // archives every plan but leaves its future effective_from intact, so a lookup
  // without the archived exclusion re-surfaced a retired program as the client's
  // current one — while the Overview, which had the exclusion, said "No plan".
  it("getNextFutureTrainingPlan excludes retired plans and looks strictly forward", async () => {
    const q = createIdQuery({
      data: {
        id: "plan-queued",
        name: "Hypertrophy Block",
        effective_from: "2026-06-20",
        effective_until: "2026-08-14",
        split_type: "upper_lower",
        frequency_per_week: 4,
        program_duration_weeks: 8,
      },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    const next = await getNextFutureTrainingPlan("client-1", "2026-06-10");

    expect(next).toEqual({
      id: "plan-queued",
      name: "Hypertrophy Block",
      effectiveFrom: "2026-06-20",
      effectiveUntil: "2026-08-14",
      splitType: "upper_lower",
      frequencyPerWeek: 4,
      programDurationWeeks: 8,
    });
    expect(q.neq).toHaveBeenCalledWith("status", "archived");
    expect(q.is).toHaveBeenCalledWith("deleted_at", null);
    expect(q.gt).toHaveBeenCalledWith("effective_from", "2026-06-10");
  });

  it("getNextFutureTrainingPlan returns null when nothing is queued", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      createIdQuery({ data: null, error: null }) as never,
    );

    expect(await getNextFutureTrainingPlan("client-1", "2026-06-10")).toBeNull();
  });

  it("getNextFutureTrainingPlan degrades to null on a read error rather than throwing", async () => {
    // Both callers render a summary that is still useful without it; a throw
    // here would blank the whole Training tab.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      createIdQuery({ data: null, error: { message: "boom" } }) as never,
    );

    expect(await getNextFutureTrainingPlan("client-1", "2026-06-10")).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("getLiveProgramWindowsForClients — the attention feed's cross-client read", () => {
  type Calls = Record<string, unknown[][]>;

  /** One thenable query serving `rows` on every page request, recording each filter. */
  function windowsQuery(rows: unknown[]) {
    const calls: Calls = {};
    const q: Record<string, unknown> = {};
    for (const method of ["select", "in", "is", "neq", "eq", "order", "range"]) {
      q[method] = vi.fn((...args: unknown[]) => {
        (calls[method] ??= []).push(args);
        return q;
      });
    }
    Object.defineProperty(q, "then", {
      value: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);
    return calls;
  }

  const plan = (client_id: string, effective_from: string, effective_until: string) => ({
    client_id,
    effective_from,
    effective_until,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads every live window off the rows — nothing derived, nothing capped in memory (migration 167)", async () => {
    // A placement inside an older program capped that program's row at the
    // day before its own start, so the rows already carry the cap.
    windowsQuery([
      plan("c1", "2026-09-07", "2026-10-04"),
      plan("c1", "2026-10-05", "2026-11-01"),
    ]);

    expect(await getLiveProgramWindowsForClients(["c1"])).toEqual([
      { clientId: "c1", start: "2026-09-07", end: "2026-10-04" },
      { clientId: "c1", start: "2026-10-05", end: "2026-11-01" },
    ]);
  });

  it("keeps clients apart and reads with the live predicates and no embedded count", async () => {
    const calls = windowsQuery([
      plan("c1", "2026-09-07", "2026-09-13"),
      plan("c2", "2026-09-28", "2026-10-18"),
    ]);

    expect(await getLiveProgramWindowsForClients(["c1", "c2"])).toEqual([
      { clientId: "c1", start: "2026-09-07", end: "2026-09-13" },
      { clientId: "c2", start: "2026-09-28", end: "2026-10-18" },
    ]);
    expect(calls.select).toEqual([["client_id, effective_from, effective_until"]]);
    expect(calls.in).toEqual([["client_id", ["c1", "c2"]]]);
    expect(calls.is).toEqual([["deleted_at", null]]);
    expect(calls.neq).toEqual([["status", "archived"]]);
    expect(calls.eq).toBeUndefined();
  });

  it("reads nothing for no ids", async () => {
    expect(await getLiveProgramWindowsForClients([])).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("getFurthestLiveProgramEnd", () => {
  const ANCHOR = "2026-09-04";

  function planQuery(result: { data?: unknown; error: unknown }) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
  }

  function wire(plan: { data?: unknown; error: unknown }) {
    const planQ = planQuery(plan);
    vi.mocked(supabaseAdmin.from).mockReturnValue(planQ as never);
    return planQ;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the furthest live end on or after the anchor off the row — one read, nothing counted", async () => {
    const planQ = wire({ data: { effective_until: "2026-10-12" }, error: null });

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBe("2026-10-12");

    expect(planQ.select).toHaveBeenCalledWith("effective_until");
    expect(planQ.gte).toHaveBeenCalledWith("effective_until", ANCHOR);
    expect(planQ.order).toHaveBeenCalledWith("effective_until", { ascending: false });
    expect(planQ.limit).toHaveBeenCalledWith(1);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("counts a program queued to start later — no start predicate on the read", async () => {
    const planQ = wire({ data: { effective_until: "2026-12-11" }, error: null });

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBe("2026-12-11");

    // A `covers today` filter of any shape would drop a queued program.
    expect(planQ.lte).not.toHaveBeenCalled();
    expect(planQ.gt).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted and archived programs", async () => {
    // The copy that forgot the archived clause re-surfaced retired plans as the
    // client's current program; the bound must not inherit that.
    const planQ = wire({ data: null, error: null });

    await getFurthestLiveProgramEnd("client-1", ANCHOR);

    expect(planQ.is).toHaveBeenCalledWith("deleted_at", null);
    expect(planQ.neq).toHaveBeenCalledWith("status", "archived");
  });

  it("returns null when no live program reaches the anchor", async () => {
    wire({ data: null, error: null });

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBeNull();
  });

  it("degrades to null on a read error rather than throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    wire({ data: null, error: { message: "boom" } });

    await expect(getFurthestLiveProgramEnd("client-1", ANCHOR)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("getTrainingPlansOverlapping", () => {
  const ROW = { id: "plan-4", name: "Peak", effective_from: "2026-09-07", effective_until: "2026-11-01" };

  function wire() {
    const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
    for (const method of ["select", "eq", "is", "neq", "gte", "lte", "order"]) {
      query[method] = vi.fn(() => query);
    }
    query.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: [ROW], error: null }).then(resolve);
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
    return query;
  }

  beforeEach(() => vi.clearAllMocks());

  it("reads the live programs meeting a range, earliest first", async () => {
    const query = wire();

    expect(await getTrainingPlansOverlapping("client-1", "2026-08-31", "2026-10-25")).toEqual([
      { id: "plan-4", name: "Peak", effectiveFrom: "2026-09-07", effectiveUntil: "2026-11-01" },
    ]);
    expect(query.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.neq).toHaveBeenCalledWith("status", "archived");
    expect(query.gte).toHaveBeenCalledWith("effective_until", "2026-08-31");
    expect(query.lte).toHaveBeenCalledWith("effective_from", "2026-10-25");
  });

  it("runs on for good without an end: every live program from the start", async () => {
    const query = wire();

    await getTrainingPlansOverlapping("client-1", "2026-08-31", null);

    expect(query.gte).toHaveBeenCalledWith("effective_until", "2026-08-31");
    expect(query.lte).not.toHaveBeenCalled();
  });
});

describe("getTrainingPlanForDate — the plan's sessions in program order", () => {
  beforeEach(() => vi.clearAllMocks());

  it("orders the sessions by day, then each day's sessions by their place (migration 180), the id last", async () => {
    const chain = (result: { data: unknown; error: unknown }) => {
      const q: Record<string, unknown> = {};
      for (const name of ["select", "eq", "neq", "is", "lte", "gte", "or", "order", "limit", "in", "range"]) {
        q[name] = vi.fn(() => q);
      }
      q.maybeSingle = vi.fn().mockResolvedValue(result);
      Object.defineProperty(q, "then", {
        value: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
      });
      return q as Record<string, ReturnType<typeof vi.fn>>;
    };
    const planQuery = chain({
      data: { id: "plan-1", client_id: "client-1", name: "P", frequency_per_week: 10, created_at: "x", updated_at: "x" },
      error: null,
    });
    const sessionsQuery = chain({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(
      ((table: string) => (table === "training_plans" ? planQuery : sessionsQuery)) as never,
    );

    await getTrainingPlanForDate("client-1", "2026-09-17");

    expect(sessionsQuery.order.mock.calls.map(([column]) => column)).toEqual([
      "week_index",
      "order_index",
      "day_order",
      "id",
    ]);
  });
});
