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

vi.mock("./training-event-service", () => ({
  deleteFutureEventsForPlan: vi.fn().mockResolvedValue(undefined),
  regenerateFutureEvents: vi.fn().mockResolvedValue(undefined),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { deleteFutureEventsForPlan, regenerateFutureEvents } from "./training-event-service";
import { createTrainingPlanAtomic, promoteTrainingPlanIfReady } from "./training-service";

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

describe("promoteTrainingPlanIfReady", () => {
  function createMockQuery(result: { data: unknown; error: unknown }) {
    return {
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gates promotion on the CLIENT's local today and anchors the delete/regen pair to it", async () => {
    // London client at 00:30 BST June 10 (23:30 UTC June 9): a plan effective
    // 06-10 must promote NOW, a day before server UTC reaches 06-10.
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");

    const plannedQuery = createMockQuery({
      data: { id: "plan-new", effective_from: "2026-06-10" },
      error: null,
    });
    const activeQuery = createMockQuery({
      data: { id: "plan-old" },
      error: null,
    });
    const updateQuery = createMockQuery({ data: null, error: null });

    let selectCalls = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation(() => {
      selectCalls++;
      if (selectCalls === 1) return plannedQuery as never;
      if (selectCalls === 2) return activeQuery as never;
      return updateQuery as never;
    });

    const result = await promoteTrainingPlanIfReady("client-1");

    expect(result).toEqual({ promoted: true, newPlanId: "plan-new" });
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    // The readiness gate compares against the client-local day.
    expect(plannedQuery.lte).toHaveBeenCalledWith("effective_from", "2026-06-10");
    // Both halves of the cleanup pair share that anchor (no UTC/local split).
    expect(deleteFutureEventsForPlan).toHaveBeenCalledWith("plan-old", "2026-06-10");
    expect(regenerateFutureEvents).toHaveBeenCalledWith("client-1", "plan-new", "2026-06-10");
  });

  it("does not promote when no planned plan has reached the client-local today", async () => {
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-09");
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      createMockQuery({ data: null, error: null }) as never,
    );

    const result = await promoteTrainingPlanIfReady("client-1");

    expect(result).toEqual({ promoted: false });
    expect(deleteFutureEventsForPlan).not.toHaveBeenCalled();
    expect(regenerateFutureEvents).not.toHaveBeenCalled();
  });
});
