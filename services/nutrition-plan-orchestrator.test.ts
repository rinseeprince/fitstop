import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-07-02"),
}));

vi.mock("@/lib/validations/nutrition", () => ({
  validateClientForNutrition: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock("@/services/body-metrics-service", () => ({
  getLatestBodyMetrics: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/client-goals-service", () => ({
  getCurrentGoals: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/nutrition-service", () => ({
  generateNutritionPlan: vi.fn(),
  calculateTDEE: vi.fn().mockReturnValue(2200),
}));

vi.mock("@/services/nutrition-plan-service", () => ({
  createNutritionPlan: vi.fn(),
  getNutritionPlanForDate: vi.fn(),
}));

vi.mock("@/services/nutrition-event-service", () => ({
  regenerateFutureNutritionEvents: vi.fn(),
  deleteFutureNutritionEventsForClient: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientById } from "@/services/client-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
import {
  createNutritionPlan,
  getNutritionPlanForDate,
} from "@/services/nutrition-plan-service";
import {
  deleteFutureNutritionEventsForClient,
  regenerateFutureNutritionEvents,
} from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
import {
  orchestrateNutritionPlanCreation,
  orchestrateNutritionPlanDeletion,
  NutritionPlanError,
} from "./nutrition-plan-orchestrator";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";

const clientId = "client-1";
const coachId = "coach-1";

const client = {
  id: clientId,
  coachId,
  currentWeight: 180,
  weightUnit: "lbs",
  bmr: 1700,
  tdee: 2400,
  gender: "male",
  goalWeight: 170,
  goalBodyFatPercentage: null,
  // No `goalDeadline`: `Client` has no such field. It was inert here (null
  // either way) but named a mirror column nothing ever read — deadlines resolve
  // from `client_goals` alone.
};

const calculatedPlan = {
  baselineCalories: 2000,
  tdee: 2400,
  calorieTarget: 2000,
  proteinTargetG: 160,
  carbTargetG: 200,
  fatTargetG: 62,
  adjustedTdee: 2400,
  weeklyWeightChangeKg: -0.4,
  requiredDailyDeficit: 400,
  warnings: [],
};

const calculatedBody: GenerateNutritionPlanRequest = {
  workActivityLevel: "sedentary",
  proteinTargetGPerKg: 2.0,
  dietType: "balanced",
} as GenerateNutritionPlanRequest;

// 150*4 + 200*4 + 60*9 = 1940 — matches customCalories exactly (within tolerance).
const customBody: GenerateNutritionPlanRequest = {
  workActivityLevel: "sedentary",
  proteinTargetGPerKg: 2.0,
  dietType: "balanced",
  customMacrosEnabled: true,
  customProteinG: 150,
  customCarbG: 200,
  customFatG: 60,
  customCalories: 1940,
} as GenerateNutritionPlanRequest;

/** handleCalculatedPlan reads the existing active plan; serve { data: null } ("initial"). */
function mockNoExistingPlan(): void {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never);
}

type ChainResult = { data?: unknown; error?: unknown };

/**
 * Deletion-path harness: each supabaseAdmin.from() call gets its own chain
 * bound to the next queued result, and every chain is THENABLE so awaited
 * builders (the queued-versions select, the queued delete, the covering
 * close) resolve it. Returned array = the chains in from()-call order, for
 * per-statement assertions.
 */
function mockFromSequence(results: ChainResult[]) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const result = results[chains.length] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "in", "update", "delete", "order", "limit"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    chains.push(chain as Record<string, ReturnType<typeof vi.fn>>);
    return chain;
  }) as never);
  return chains;
}

/** An open covering version — the ordinary single-version client. */
const coveringRow = {
  id: "plan-1",
  effective_from: "2026-06-01",
  effective_until: null,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientById).mockResolvedValue(client as never);
  vi.mocked(generateNutritionPlan).mockReturnValue(calculatedPlan as never);
  vi.mocked(createNutritionPlan).mockResolvedValue("plan-1" as never);
  vi.mocked(regenerateFutureNutritionEvents).mockResolvedValue(undefined);
  vi.mocked(getNutritionPlanForDate).mockResolvedValue(coveringRow);
  vi.mocked(deleteFutureNutritionEventsForClient).mockResolvedValue(undefined);
  mockNoExistingPlan();
});

describe("orchestrateNutritionPlanCreation — event-rewrite error propagation", () => {
  it("calculated branch: resolves success when the event rewrite succeeds", async () => {
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});
    expect(result.success).toBe(true);
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(clientId, "plan-1", { kind: "from", from: "2026-07-02" });
  });

  it("calculated branch: rejects with NutritionPlanError when the event rewrite fails", async () => {
    const dbError = new Error("upsert exploded");
    vi.mocked(regenerateFutureNutritionEvents).mockRejectedValue(dbError);

    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {})
    ).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 500,
      message:
        "Plan targets were saved, but calendar events failed to update. Regenerate the plan to retry.",
    });
  });

  it("calculated branch: still reports the underlying failure to Sentry", async () => {
    const dbError = new Error("upsert exploded");
    vi.mocked(regenerateFutureNutritionEvents).mockRejectedValue(dbError);

    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {})
    ).rejects.toBeInstanceOf(NutritionPlanError);
    expect(captureApiError).toHaveBeenCalledWith(dbError, {
      action: "generate-nutrition-events",
      planId: "plan-1",
    });
  });

  it("custom-macros branch: resolves success when the event rewrite succeeds", async () => {
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, customBody, {});
    expect(result.success).toBe(true);
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(clientId, "plan-1", { kind: "from", from: "2026-07-02" });
  });

  it("custom-macros branch: rejects with NutritionPlanError when the event rewrite fails", async () => {
    vi.mocked(regenerateFutureNutritionEvents).mockRejectedValue(new Error("delete exploded"));

    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, customBody, {})
    ).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 500,
      message:
        "Plan targets were saved, but calendar events failed to update. Regenerate the plan to retry.",
    });
    expect(captureApiError).toHaveBeenCalled();
  });

  it("anchors the rewrite on effectiveFrom when provided", async () => {
    await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, effectiveFrom: "2026-07-10" },
      {}
    );
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(clientId, "plan-1", { kind: "from", from: "2026-07-10" });
  });
});

describe("orchestrateNutritionPlanDeletion — chain semantics (migration 144, D2)", () => {
  it("closes the covering version at today (status untouched) after clearing events from tomorrow", async () => {
    // from() #1 = queued-versions select (none), #2 = the covering close.
    const chains = mockFromSequence([{ data: [], error: null }, { error: null }]);

    const result = await orchestrateNutritionPlanDeletion(clientId, coachId);

    expect(result).toEqual({ planId: "plan-1" });
    // Floor is the day AFTER the client-local today ('2026-07-02'): today's
    // event survives so a part-logged day keeps its plan context. Client-scoped
    // so rows stamped by queued versions' ids are swept too.
    expect(deleteFutureNutritionEventsForClient).toHaveBeenCalledWith(clientId, "2026-07-03");
    // The queued select probes strictly-future versions against client-today.
    expect(chains[0].gt).toHaveBeenCalledWith("effective_from", "2026-07-02");
    // D2(a): close-never-erase — effective_until = clientToday, NO status write.
    expect(chains[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-07-02" })
    );
    expect(chains[1].update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.anything() })
    );
    expect(chains[1].eq).toHaveBeenCalledWith("id", "plan-1");
    // Events go first so a mid-flight failure leaves the version open and retryable.
    expect(
      vi.mocked(deleteFutureNutritionEventsForClient).mock.invocationCallOrder[0]
    ).toBeLessThan(chains[1].update.mock.invocationCallOrder[0]);
  });

  it("hard-deletes queued versions (D2(b)) alongside closing the covering one", async () => {
    // #1 queued select, #2 queued delete, #3 covering close.
    const chains = mockFromSequence([
      { data: [{ id: "q1" }, { id: "q2" }], error: null },
      { error: null },
      { error: null },
    ]);

    const result = await orchestrateNutritionPlanDeletion(clientId, coachId);

    expect(result).toEqual({ planId: "plan-1" });
    expect(chains[1].delete).toHaveBeenCalled();
    expect(chains[1].in).toHaveBeenCalledWith("id", ["q1", "q2"]);
    expect(chains[2].update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-07-02" })
    );
  });

  it("deletes a queued-only chain (no covering version) instead of 404ing", async () => {
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(null);
    const chains = mockFromSequence([
      { data: [{ id: "q1" }], error: null },
      { error: null },
    ]);

    const result = await orchestrateNutritionPlanDeletion(clientId, coachId);

    expect(result).toEqual({ planId: "q1" });
    expect(deleteFutureNutritionEventsForClient).toHaveBeenCalledWith(clientId, "2026-07-03");
    expect(chains[1].in).toHaveBeenCalledWith("id", ["q1"]);
    // No covering version → nothing to close: from() was called exactly twice.
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(2);
  });

  it("rejects 404 when the chain already ends at today (same-day second delete), touching nothing", async () => {
    // Covering version closed AT today by a prior delete → reaches nothing past today.
    vi.mocked(getNutritionPlanForDate).mockResolvedValue({
      id: "plan-1",
      effective_from: "2026-06-01",
      effective_until: "2026-07-02",
    } as never);
    mockFromSequence([{ data: [], error: null }]);

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 404,
      message: "No active nutrition plan to delete",
    });
    expect(deleteFutureNutritionEventsForClient).not.toHaveBeenCalled();
  });

  it("rejects 404 when the client does not exist", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 404,
    });
    expect(deleteFutureNutritionEventsForClient).not.toHaveBeenCalled();
  });

  it("rejects 403 when the coach does not own the client", async () => {
    await expect(orchestrateNutritionPlanDeletion(clientId, "other-coach")).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 403,
    });
    expect(deleteFutureNutritionEventsForClient).not.toHaveBeenCalled();
  });

  it("propagates an event-delete failure without touching the versions (chain stays retryable)", async () => {
    const chains = mockFromSequence([{ data: [{ id: "q1" }], error: null }]);
    vi.mocked(deleteFutureNutritionEventsForClient).mockRejectedValue(new Error("delete exploded"));

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toThrow(
      "delete exploded"
    );
    // Neither the queued delete nor the covering close ran: only the queued
    // SELECT chain exists, and no later from() call was made.
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(1);
    expect(chains[0].delete).not.toHaveBeenCalled();
  });
});
