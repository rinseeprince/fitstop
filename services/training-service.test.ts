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

// Only the next-plan cap is stubbed, so calculatePlacementEndDate — the shared
// definition of the day a program ends — runs for real underneath the horizon
// read below.
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
  getTrainingPlanIdForDate,
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

  // The regression this function exists to prevent: "Delete future sessions"
  // archives every plan but leaves its future effective_from intact, so a lookup
  // without the archived exclusion re-surfaced a retired program as the client's
  // current one — while the Overview, which had the exclusion, said "No plan".
  it("getNextFutureTrainingPlan excludes retired plans and looks strictly forward", async () => {
    const q = createIdQuery({
      data: {
        id: "plan-queued",
        name: "Hypertrophy Block",
        effective_from: "2026-06-20",
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

// ===========================================================================
// getFurthestLiveProgramEnd — the SECOND term of the nutrition generation
// horizon, used when the client has no block declaring a bound.
//
// The end is derived from the program's authored day-count, NOT from
// `effective_until`: nothing has ever written that column (the placement RPC
// omits it deliberately), so reading it would leave the horizon frozen at the
// fixed window for every client alive.
// ===========================================================================

describe("getFurthestLiveProgramEnd", () => {
  const ANCHOR = "2026-09-04";

  function planQuery(result: { data?: unknown; error: unknown }) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
  }

  function slotCountQuery(result: { count: number | null; error: unknown }) {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      then: (resolve: (v: typeof result) => void) =>
        Promise.resolve(result).then(resolve),
    });
    return q as ReturnType<typeof planQuery> & { then: unknown };
  }

  /** The plan read, then the slot count — in call order. */
  function wire(
    plan: { data?: unknown; error: unknown },
    slots: { count: number | null; error: unknown },
  ) {
    const planQ = planQuery(plan);
    const slotQ = slotCountQuery(slots);
    let call = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((() => {
      call += 1;
      return call === 1 ? planQ : slotQ;
    }) as never);
    return { planQ, slotQ };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the end from the authored day-count, never from effective_until", async () => {
    // 36 authored days from 2026-09-07 runs to 2026-10-12 inclusive.
    wire({ data: { id: "plan-36", effective_from: "2026-09-07" }, error: null }, {
      count: 36,
      error: null,
    });

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBe("2026-10-12");
  });

  it("counts a program queued to start later — no date predicate on the read", async () => {
    // Placed on the 4th to begin on the 19th, 84 days long: it must stretch the
    // horizon to 2026-12-11 exactly as a running program would.
    const { planQ } = wire(
      { data: { id: "plan-84", effective_from: "2026-09-19" }, error: null },
      { count: 84, error: null },
    );

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBe("2026-12-11");

    // A `covers today` filter of any shape would drop it entirely.
    expect(planQ.lte).not.toHaveBeenCalled();
    expect(planQ.gt).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted and archived programs", async () => {
    // The copy that forgot the archived clause re-surfaced retired plans as the
    // client's current program; the horizon must not inherit that.
    const { planQ } = wire({ data: null, error: null }, { count: null, error: null });

    await getFurthestLiveProgramEnd("client-1", ANCHOR);

    expect(planQ.is).toHaveBeenCalledWith("deleted_at", null);
    expect(planQ.neq).toHaveBeenCalledWith("status", "archived");
  });

  it("measures the LAST-STARTING program, which is provably the furthest end", async () => {
    // Placement caps a program at the day before the next one begins, so ends
    // increase with start dates: whichever starts last ends last.
    const { planQ } = wire(
      { data: { id: "plan-late", effective_from: "2026-09-14" }, error: null },
      { count: 21, error: null },
    );

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBe("2026-10-04");

    expect(planQ.order).toHaveBeenCalledWith("effective_from", { ascending: false });
    expect(planQ.limit).toHaveBeenCalledWith(1);
  });

  it("returns null when the furthest program has already finished", async () => {
    // 14 days from 2026-08-05 ended on 2026-08-18, behind the anchor — it must
    // not drag the horizon backwards past the day generation starts.
    wire({ data: { id: "plan-done", effective_from: "2026-08-05" }, error: null }, {
      count: 14,
      error: null,
    });

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBeNull();
  });

  it("returns null when the client has no live program", async () => {
    wire({ data: null, error: null }, { count: null, error: null });

    expect(await getFurthestLiveProgramEnd("client-1", ANCHOR)).toBeNull();
  });

  it("degrades to null on a read error rather than throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    wire({ data: null, error: { message: "boom" } }, { count: null, error: null });

    await expect(getFurthestLiveProgramEnd("client-1", ANCHOR)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
