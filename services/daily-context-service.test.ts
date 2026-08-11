import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./nutrition-event-service", () => ({ getNutritionEventForDate: vi.fn() }));
vi.mock("./training-event-service", () => ({ getEventForDate: vi.fn() }));
vi.mock("./nutrition-plan-service", () => ({
  getNutritionPlanIdForDate: vi.fn(),
}));
vi.mock("./training-service", () => ({ getActiveTrainingPlanId: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getEventForDate } from "./training-event-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { getActiveTrainingPlanId } from "./training-service";
import {
  resolvePlanContextForDate,
  getNutritionForDate,
  assertHasActivePlan,
  NoActivePlanError,
} from "./daily-context-service";

beforeEach(() => vi.clearAllMocks());

describe("resolvePlanContextForDate", () => {
  it("uses date-accurate event plan ids when present", async () => {
    vi.mocked(getNutritionEventForDate).mockResolvedValue({ nutritionPlanId: "np-1" } as never);
    vi.mocked(getEventForDate).mockResolvedValue({ trainingPlanId: "tp-1" } as never);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ nutritionPlanId: "np-1", trainingPlanId: "tp-1" });
    expect(getNutritionPlanIdForDate).not.toHaveBeenCalled();
    // Date-accurate event present → no active-plan fallback for training either.
    expect(getActiveTrainingPlanId).not.toHaveBeenCalled();
  });

  it("falls back to the version covering the LOG's date, not a date-blind singleton", async () => {
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-covering");
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue("tp-active");

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    // The per-date pin: a backdated log stamps its own day's era.
    expect(getNutritionPlanIdForDate).toHaveBeenCalledWith("c1", "2026-05-21");
    expect(ctx).toEqual({ nutritionPlanId: "np-covering", trainingPlanId: "tp-active" });
  });

  it("a pre-start day (queued-first-plan client) gets a NULL nutrition stamp — no covering version", async () => {
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);
    vi.mocked(getEventForDate).mockResolvedValue(null);
    // No version covers this date — only a future one is queued, which
    // resolvePlanContextForDate deliberately does NOT consult: a queued plan is
    // not a target for today, so the stamp stays null and the guard rejects.
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ nutritionPlanId: null, trainingPlanId: null });
  });

  it("returns all-null when there is no plan at all", async () => {
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ nutritionPlanId: null, trainingPlanId: null });
  });
});

describe("assertHasActivePlan", () => {
  const ctx = (overrides: Partial<Parameters<typeof assertHasActivePlan>[0]> = {}) => ({
    nutritionPlanId: "np-1" as string | null,
    trainingPlanId: "tp-1" as string | null,
    ...overrides,
  });

  it("nutrition: throws when the stamp is null (pre-start / no covering version), no-ops when populated", () => {
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

});

describe("getNutritionForDate", () => {
  const nutritionLogsRow = (row: Record<string, unknown> | null) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  });
  const clientsRow = (surplusAsCarbs = false) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { include_activity_burn: true, surplus_as_carbs: surplusAsCarbs },
      error: null,
    }),
  });
  const fromImpl = (logRow: Record<string, unknown> | null, surplusAsCarbs = false) =>
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
      table === "nutrition_logs" ? nutritionLogsRow(logRow) : clientsRow(surplusAsCarbs)) as never);

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
      dayOfWeek: "thursday", baselineCalories: 2000, trainingBurnCalories: 0,
      proteinG: 150, carbG: 200, fatG: 60, isTrainingDay: false, isModified: false,
      calorieSurplusPercentage: null,
    } as never);

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result.source).toBe("event");
    expect(result.consumed).toBeNull();
    expect(result.target?.proteinG).toBe(150);
  });

  it("level 2: a training-day surplus is split by surplus_as_carbs (per-day lane matches the calendar)", async () => {
    // baseline 2000, protein 150, carb 100, fat 50, +10% surplus → total 2200.
    const event = {
      dayOfWeek: "monday", baselineCalories: 2000, trainingBurnCalories: 0,
      proteinG: 150, carbG: 100, fatG: 50, isTrainingDay: true, isModified: false,
      calorieSurplusPercentage: 10,
    };

    // keep-split (default): carbs+fat scale preserving the stored ratio.
    fromImpl(null, false);
    vi.mocked(getNutritionEventForDate).mockResolvedValue(event as never);
    let result = await getNutritionForDate("c1", "2026-06-08");
    expect(result.target).toEqual({ calories: 2200, proteinG: 150, carbsG: 188, fatG: 94, note: null });

    // carbs-only: fat held, the surplus goes to carbs.
    fromImpl(null, true);
    vi.mocked(getNutritionEventForDate).mockResolvedValue(event as never);
    result = await getNutritionForDate("c1", "2026-06-08");
    expect(result.target).toEqual({ calories: 2200, proteinG: 150, carbsG: 288, fatG: 50, note: null });
  });

  it("level 3: no log and no event → null", async () => {
    fromImpl(null);
    vi.mocked(getNutritionEventForDate).mockResolvedValue(null);

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result).toEqual({ consumed: null, target: null, source: null });
  });
});
