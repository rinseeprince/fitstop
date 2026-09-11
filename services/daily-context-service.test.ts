import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./nutrition-days-service", () => ({ getNutritionTargetsForDateRange: vi.fn() }));
vi.mock("./training-event-service", () => ({ getEventForDate: vi.fn() }));
vi.mock("./nutrition-plan-service", () => ({
  getNutritionPlanIdForDate: vi.fn(),
}));
vi.mock("./training-service", () => ({ getActiveTrainingPlanId: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from "./nutrition-days-service";
import { getEventForDate } from "./training-event-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { getActiveTrainingPlanId } from "./training-service";
import {
  resolvePlanContextForDate,
  getNutritionForDate,
  getPlanTargetForDate,
  assertHasActivePlan,
  NoActivePlanError,
} from "./daily-context-service";

beforeEach(() => vi.clearAllMocks());

const computedTarget = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 160,
  carbsG: 210,
  fatG: 65,
  isTrainingDay: false,
  note: null,
});

/** The day reader's answer for a range: the computed target, or nothing. */
function wireTargets(target: NutritionDayTarget | null) {
  vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(
    new Map(target ? [[target.date, target]] : [])
  );
}

/** The standing food log for the day, as the resolver reads it. */
function wireStandingLog(row: { nutrition_plan_id: string | null } | null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "nutrition_logs") return query;
    throw new Error(`Unexpected table: ${table}`);
  }) as never);
  return query;
}

describe("resolvePlanContextForDate", () => {
  it("stamps nutrition from the version covering the LOG's date — a computed day has no row to prefer", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-covering");
    vi.mocked(getEventForDate).mockResolvedValue({ trainingPlanId: "tp-1" } as never);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    // The per-date pin: a backdated log stamps its own day's era.
    expect(getNutritionPlanIdForDate).toHaveBeenCalledWith("c1", "2026-05-21");
    // A computed day derives from that same version, so no day is read for it.
    expect(getNutritionTargetsForDateRange).not.toHaveBeenCalled();
    expect(ctx).toEqual({ nutritionPlanId: "np-covering", trainingPlanId: "tp-1" });
    // Date-accurate training event present → no active-plan fallback.
    expect(getActiveTrainingPlanId).not.toHaveBeenCalled();
    // A covered day never reads the standing log: the version is the stamp.
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("nutrition_logs");
  });

  // Owner, 2026-09-11: a started day stays open. The coach ended or replaced
  // the plan after the client began the day, so no version covers it — the
  // day takes the stamp its own log carries, the guard passes, and the writer
  // keeps the target the day was logged under.
  it("a day no version covers but the client has begun keeps the stamp its log carries", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);
    const query = wireStandingLog({ nutrition_plan_id: "np-logged-under" });

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(query.eq).toHaveBeenCalledWith("client_id", "c1");
    expect(query.eq).toHaveBeenCalledWith("date", "2026-05-21");
    expect(ctx.nutritionPlanId).toBe("np-logged-under");
    expect(() => assertHasActivePlan(ctx, "nutrition")).not.toThrow();
  });

  it("training falls back to the active plan on a no-event day", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-covering");
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue("tp-active");

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(getActiveTrainingPlanId).toHaveBeenCalledWith("c1");
    expect(ctx).toEqual({ nutritionPlanId: "np-covering", trainingPlanId: "tp-active" });
  });

  it("a pre-start day (queued-first-plan client) gets a NULL nutrition stamp — no covering version, nothing logged", async () => {
    vi.mocked(getEventForDate).mockResolvedValue(null);
    // No version covers this date — only a future one is queued, which
    // resolvePlanContextForDate deliberately does NOT consult: a queued plan is
    // not a target for today — and the client has not begun the day, so the
    // stamp stays null and the guard rejects.
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);
    wireStandingLog(null);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ nutritionPlanId: null, trainingPlanId: null });
    expect(() => assertHasActivePlan(ctx, "nutrition")).toThrow(NoActivePlanError);
  });

  it("returns all-null when there is no plan at all", async () => {
    vi.mocked(getEventForDate).mockResolvedValue(null);
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);
    wireStandingLog(null);

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

describe("getPlanTargetForDate", () => {
  it("is the day reader's target over one day", async () => {
    wireTargets(computedTarget("2026-05-21", 2100));

    const target = await getPlanTargetForDate("c1", "2026-05-21");

    expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith("c1", "2026-05-21", "2026-05-21");
    expect(target).toMatchObject({ calories: 2100, proteinG: 160, carbsG: 210, fatG: 65 });
  });

  it("is null on a day no version covers", async () => {
    wireTargets(null);
    expect(await getPlanTargetForDate("c1", "2026-05-21")).toBeNull();
  });
});

// The food log stores what the client ate and nothing else (owner,
// 2026-09-11): the target for EVERY day is the computed day, logged or not.
describe("getNutritionForDate", () => {
  const logsTable = (row: Record<string, unknown> | null) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
      if (table === "nutrition_logs") return query;
      throw new Error(`Unexpected table: ${table}`);
    }) as never);
    return query;
  };

  it("a logged day: the row supplies what was eaten, the computed day supplies the target (source 'log')", async () => {
    // The row still carries a stale target from before the copy was removed;
    // it must never be the answer.
    const query = logsTable({
      calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, target_calories: 9999,
    });
    wireTargets(computedTarget("2026-05-21", 2100));

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(query.select).toHaveBeenCalledWith("calories_consumed, protein_g, carbs_g, fat_g");
    expect(result.source).toBe("log");
    expect(result.consumed).toEqual({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
    expect(result.target).toEqual({ calories: 2100, proteinG: 160, carbsG: 210, fatG: 65, note: null });
    expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith("c1", "2026-05-21", "2026-05-21");
  });

  it("a logged day no version covers keeps its meals and has no target", async () => {
    logsTable({ calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 });
    wireTargets(null);

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result).toEqual({
      consumed: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
      target: null,
      source: "log",
    });
  });

  it("an unlogged day a version covers: the computed target alone (source 'event'), note included", async () => {
    logsTable(null);
    wireTargets({ ...computedTarget("2026-05-21", 2100), note: "Deload week" });

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result.source).toBe("event");
    expect(result.consumed).toBeNull();
    expect(result.target).toEqual({ calories: 2100, proteinG: 160, carbsG: 210, fatG: 65, note: "Deload week" });
  });

  it("no log and no version covering the date → nothing", async () => {
    logsTable(null);
    wireTargets(null);

    const result = await getNutritionForDate("c1", "2026-05-21");

    expect(result).toEqual({ consumed: null, target: null, source: null });
  });
});
