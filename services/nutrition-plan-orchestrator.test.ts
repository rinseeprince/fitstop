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
} from "@/services/nutrition-plan-service";
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
