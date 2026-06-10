import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./phase-service", () => ({ getActivePhase: vi.fn() }));
vi.mock("./nutrition-event-service", () => ({ getNutritionEventForDate: vi.fn() }));
vi.mock("./training-event-service", () => ({ getEventForDate: vi.fn() }));
vi.mock("./nutrition-plan-service", () => ({ getActiveNutritionPlanId: vi.fn() }));
vi.mock("./training-service", () => ({ getActiveTrainingPlanId: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getActivePhase } from "./phase-service";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getEventForDate } from "./training-event-service";
import { getActiveNutritionPlanId } from "./nutrition-plan-service";
import { getActiveTrainingPlanId } from "./training-service";
import {
  resolvePlanContextForDate,
  getNutritionForDate,
  assertHasActivePlan,
  NoActivePlanError,
} from "./daily-context-service";

beforeEach(() => vi.clearAllMocks());

describe("resolvePlanContextForDate", () => {
  it("uses date-accurate event plan ids and the active phase when present", async () => {
    vi.mocked(getActivePhase).mockResolvedValue({ id: "phase-1" } as never);
    vi.mocked(getNutritionEventForDate).mockResolvedValue({ nutritionPlanId: "np-1" } as never);
    vi.mocked(getEventForDate).mockResolvedValue({ trainingPlanId: "tp-1" } as never);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ phaseId: "phase-1", nutritionPlanId: "np-1", trainingPlanId: "tp-1" });
    expect(getActiveNutritionPlanId).not.toHaveBeenCalled();
    // Date-accurate event present → no active-plan fallback for training either.
    expect(getActiveTrainingPlanId).not.toHaveBeenCalled();
  });

  it("falls back to the active nutrition AND training plans when there is no event", async () => {
    vi.mocked(getActivePhase).mockResolvedValue(null);
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getActiveNutritionPlanId).mockResolvedValue("np-active");
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue("tp-active");

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ phaseId: null, nutritionPlanId: "np-active", trainingPlanId: "tp-active" });
  });

  it("returns all-null when there is no plan at all", async () => {
    vi.mocked(getActivePhase).mockResolvedValue(null);
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getActiveNutritionPlanId).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ phaseId: null, nutritionPlanId: null, trainingPlanId: null });
  });
});

describe("assertHasActivePlan", () => {
  const ctx = (overrides: Partial<Parameters<typeof assertHasActivePlan>[0]> = {}) => ({
    phaseId: "phase-1",
    nutritionPlanId: "np-1",
    trainingPlanId: "tp-1",
    ...overrides,
  });

  it("nutrition: throws when nutritionPlanId is null, no-ops when populated", () => {
    expect(() => assertHasActivePlan(ctx({ nutritionPlanId: null }), "nutrition")).toThrow(
      NoActivePlanError
    );
    expect(() => assertHasActivePlan(ctx(), "nutrition")).not.toThrow();
  });

  it("training: throws when trainingPlanId is null, no-ops when populated", () => {
    expect(() => assertHasActivePlan(ctx({ trainingPlanId: null }), "training")).toThrow(
      NoActivePlanError
    );
    expect(() => assertHasActivePlan(ctx(), "training")).not.toThrow();
  });

  it("the thrown error carries the resource discriminator", () => {
    try {
      assertHasActivePlan(ctx({ nutritionPlanId: null }), "nutrition");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NoActivePlanError);
      expect((err as NoActivePlanError).resource).toBe("nutrition");
      expect((err as NoActivePlanError).message).toBe("No active plan for nutrition");
    }
  });

  it("never gates on phaseId — a no-phase client's plan ids alone decide", () => {
    expect(() => assertHasActivePlan(ctx({ phaseId: null }), "nutrition")).not.toThrow();
    expect(() => assertHasActivePlan(ctx({ phaseId: null }), "training")).not.toThrow();
  });
});

describe("getNutritionForDate", () => {
  const nutritionLogsRow = (row: Record<string, unknown> | null) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  });
  const clientsRow = () => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { include_activity_burn: true }, error: null }),
  });
  const fromImpl = (logRow: Record<string, unknown> | null) =>
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
      table === "nutrition_logs" ? nutritionLogsRow(logRow) : clientsRow()) as never);

  it("level 1: returns the logged snapshot (source 'log')", async () => {
    fromImpl({
      calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60,
      target_calories: 2100, target_protein_g: 160, target_carbs_g: 210, target_fat_g: 65,
    });

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result.source).toBe("log");
    expect(result.consumed).toEqual({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
    expect(result.target).toEqual({ calories: 2100, proteinG: 160, carbsG: 210, fatG: 65 });
    expect(getNutritionEventForDate).not.toHaveBeenCalled();
  });

  it("level 2: no log but an event → event target (source 'event')", async () => {
    fromImpl(null);
    vi.mocked(getNutritionEventForDate).mockResolvedValue({
      baselineCalories: 2000, trainingBurnCalories: 0,
      proteinG: 150, carbG: 200, fatG: 60, isTrainingDay: false,
      calorieSurplusPercentage: null,
    } as never);

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result.source).toBe("event");
    expect(result.consumed).toBeNull();
    expect(result.target?.proteinG).toBe(150);
  });

  it("level 3: no log and no event → null", async () => {
    fromImpl(null);
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result).toEqual({ consumed: null, target: null, source: null });
  });
});
