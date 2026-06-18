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

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { createTrainingPlanAtomic, getActiveTrainingPlanId, getTrainingPlanIdForDate } from "./training-service";

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
});
