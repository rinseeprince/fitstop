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
  archiveNutritionPlan: vi.fn(),
  getActiveNutritionPlanId: vi.fn(),
  stampPhasesFingerprint: vi.fn(),
}));

// Blocks: default to a client with none, so every pre-existing assertion in this
// file describes today's no-blocks behaviour rather than being rewritten around
// the new one.
vi.mock("@/services/client-phases-service", () => ({
  getClientPhases: vi.fn().mockResolvedValue([]),
  writePhaseDailyTargets: vi.fn(),
}));

vi.mock("@/services/nutrition-event-service", () => ({
  regenerateFutureNutritionEvents: vi.fn(),
  deleteFutureNutritionEventsForPlan: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientById } from "@/services/client-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
import {
  archiveNutritionPlan,
  createNutritionPlan,
  getActiveNutritionPlanId,
  stampPhasesFingerprint,
} from "@/services/nutrition-plan-service";
import {
  getClientPhases,
  writePhaseDailyTargets,
} from "@/services/client-phases-service";
import {
  deleteFutureNutritionEventsForPlan,
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
  goalDeadline: null,
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
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientById).mockResolvedValue(client as never);
  vi.mocked(generateNutritionPlan).mockReturnValue(calculatedPlan as never);
  vi.mocked(createNutritionPlan).mockResolvedValue("plan-1" as never);
  vi.mocked(regenerateFutureNutritionEvents).mockResolvedValue(undefined);
  vi.mocked(getActiveNutritionPlanId).mockResolvedValue("plan-1");
  vi.mocked(archiveNutritionPlan).mockResolvedValue(undefined);
  vi.mocked(deleteFutureNutritionEventsForPlan).mockResolvedValue(undefined);
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

describe("orchestrateNutritionPlanDeletion", () => {
  it("clears events from TOMORROW (client-local) then archives, and returns the plan id", async () => {
    const result = await orchestrateNutritionPlanDeletion(clientId, coachId);

    expect(result).toEqual({ planId: "plan-1" });
    // Floor is the day AFTER the client-local today ('2026-07-02'): today's
    // event survives so a part-logged day keeps its plan context.
    expect(deleteFutureNutritionEventsForPlan).toHaveBeenCalledWith("plan-1", "2026-07-03");
    expect(archiveNutritionPlan).toHaveBeenCalledWith("plan-1");
    // Events go first so a mid-flight failure leaves the plan active and retryable.
    expect(
      vi.mocked(deleteFutureNutritionEventsForPlan).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(archiveNutritionPlan).mock.invocationCallOrder[0]);
  });

  it("rejects 404 when the client does not exist", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 404,
    });
    expect(archiveNutritionPlan).not.toHaveBeenCalled();
  });

  it("rejects 403 when the coach does not own the client", async () => {
    await expect(orchestrateNutritionPlanDeletion(clientId, "other-coach")).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 403,
    });
    expect(deleteFutureNutritionEventsForPlan).not.toHaveBeenCalled();
    expect(archiveNutritionPlan).not.toHaveBeenCalled();
  });

  it("rejects 404 when there is no active plan, touching nothing", async () => {
    vi.mocked(getActiveNutritionPlanId).mockResolvedValue(null);

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toMatchObject({
      name: "NutritionPlanError",
      statusCode: 404,
      message: "No active nutrition plan to delete",
    });
    expect(deleteFutureNutritionEventsForPlan).not.toHaveBeenCalled();
    expect(archiveNutritionPlan).not.toHaveBeenCalled();
  });

  it("propagates an event-delete failure without archiving (plan stays retryable)", async () => {
    vi.mocked(deleteFutureNutritionEventsForPlan).mockRejectedValue(new Error("delete exploded"));

    await expect(orchestrateNutritionPlanDeletion(clientId, coachId)).rejects.toThrow(
      "delete exploded"
    );
    expect(archiveNutritionPlan).not.toHaveBeenCalled();
  });
});

describe("per-block generation (task 2.6)", () => {
  const phases = [
    { id: "p1", name: "Cut 1", startsOn: "2026-08-01", endsOn: "2026-08-28", ratePerWeekKg: -0.5, dailyTargets: null },
    { id: "p2", name: "Diet break", startsOn: "2026-08-29", endsOn: "2026-09-11", ratePerWeekKg: 0, dailyTargets: null },
  ];

  beforeEach(() => {
    vi.mocked(getClientPhases).mockResolvedValue(phases as never);
    vi.mocked(writePhaseDailyTargets).mockResolvedValue(undefined);
    vi.mocked(stampPhasesFingerprint).mockResolvedValue(undefined);
  });

  it("writes one grid per block and returns a row per block", async () => {
    const result = await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    const written = vi.mocked(writePhaseDailyTargets).mock.calls[0][1];
    expect(written.map((w) => w.phaseId)).toEqual(["p1", "p2"]);
    expect(written[0].dailyTargets).toHaveLength(7);

    // Each block carries its OWN target: -0.5 kg/wk vs maintenance off TDEE 2400.
    expect(result.phases?.map((p) => p.baselineCalories)).toEqual([1850, 2400]);
  });

  it("stamps the fingerprint AFTER the events — it means 'everything succeeded'", async () => {
    await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    const gridOrder = vi.mocked(writePhaseDailyTargets).mock.invocationCallOrder[0];
    const planOrder = vi.mocked(createNutritionPlan).mock.invocationCallOrder[0];
    const eventOrder = vi.mocked(regenerateFutureNutritionEvents).mock.invocationCallOrder[0];
    const stampOrder = vi.mocked(stampPhasesFingerprint).mock.invocationCallOrder[0];

    // grids -> plan -> events -> stamp. Any other order lets the stored hash
    // assert a block set the client's events do not actually follow.
    expect(gridOrder).toBeLessThan(planOrder);
    expect(planOrder).toBeLessThan(eventOrder);
    expect(eventOrder).toBeLessThan(stampOrder);
  });

  it("does NOT stamp when the event rewrite fails — the plan reads as stale", async () => {
    vi.mocked(regenerateFutureNutritionEvents).mockRejectedValue(new Error("boom"));

    await expect(
      orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {})
    ).rejects.toBeInstanceOf(NutritionPlanError);

    // Stale is the safe direction: a visible "out of date" row that clears on
    // the next regenerate, rather than a plan affirmatively claiming to be current.
    expect(stampPhasesFingerprint).not.toHaveBeenCalled();
  });

  it("stamps NULL for a client with no blocks", async () => {
    vi.mocked(getClientPhases).mockResolvedValue([]);

    const result = await orchestrateNutritionPlanCreation(clientId, coachId, calculatedBody, {});

    expect(writePhaseDailyTargets).not.toHaveBeenCalled();
    expect(stampPhasesFingerprint).toHaveBeenCalledWith("plan-1", null);
    // Absent, not [] — the UI must tell "no blocks" from "blocks produced nothing".
    expect(result.phases).toBeUndefined();
  });

  it("custom macros stamp NULL even when the client HAS blocks", async () => {
    // The coach typed these numbers and the calculator never ran, so no block
    // drove them. Clearing the hash also stops a plan that used to be
    // block-driven from claiming those blocks are still current.
    await orchestrateNutritionPlanCreation(clientId, coachId, customBody, {});

    expect(writePhaseDailyTargets).not.toHaveBeenCalled();
    expect(stampPhasesFingerprint).toHaveBeenCalledWith("plan-1", null);
  });

  it("preserveCalories stamps NULL — it reuses a baseline rather than calculating", async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { baseline_calories: 2100 }, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never);

    const result = await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      { ...calculatedBody, preserveCalories: true } as GenerateNutritionPlanRequest,
      {}
    );

    expect(writePhaseDailyTargets).not.toHaveBeenCalled();
    expect(stampPhasesFingerprint).toHaveBeenCalledWith("plan-1", null);
    expect(result.phases).toBeUndefined();
  });
});
