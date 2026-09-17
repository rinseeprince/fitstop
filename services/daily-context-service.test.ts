import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./nutrition-days-service", () => ({ getNutritionTargetsForDateRange: vi.fn() }));
vi.mock("./training-event-service", () => ({ getFirstEventForDate: vi.fn() }));
vi.mock("./nutrition-plan-service", () => ({
  getNutritionPlanIdForDate: vi.fn(),
}));
vi.mock("./training-service", () => ({ getActiveTrainingPlanId: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from "./nutrition-days-service";
import { getFirstEventForDate } from "./training-event-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { getActiveTrainingPlanId } from "./training-service";
import {
  resolvePlanContextForDate,
  getNutritionForDate,
  getPlanTargetForDate,
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

describe("resolvePlanContextForDate", () => {
  it("stamps nutrition from the version covering the LOG's date — a computed day has no row to prefer", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-covering");
    vi.mocked(getFirstEventForDate).mockResolvedValue({ trainingPlanId: "tp-1" } as never);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    // The per-date pin: a backdated log stamps its own day's era.
    expect(getNutritionPlanIdForDate).toHaveBeenCalledWith("c1", "2026-05-21");
    // A computed day derives from that same version, so no day is read for it.
    expect(getNutritionTargetsForDateRange).not.toHaveBeenCalled();
    expect(ctx).toEqual({ nutritionPlanId: "np-covering", trainingPlanId: "tp-1" });
    // Date-accurate training event present → no active-plan fallback.
    expect(getActiveTrainingPlanId).not.toHaveBeenCalled();
    // The version is the stamp; the log is never read for one.
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("training falls back to the active plan on a no-event day", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-covering");
    vi.mocked(getFirstEventForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue("tp-active");

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(getActiveTrainingPlanId).toHaveBeenCalledWith("c1");
    expect(ctx).toEqual({ nutritionPlanId: "np-covering", trainingPlanId: "tp-active" });
  });

  // A day no version covers — a pre-start day for a queued-first-plan client,
  // a gap after a delete — has no stamp, and the meal still saves without
  // one (owner, 2026-09-11): the log is never read for a stamp of its own.
  it("a day no version covers gets a NULL nutrition stamp, and the log is not read for one", async () => {
    vi.mocked(getFirstEventForDate).mockResolvedValue(null);
    // Only a future version is queued, which resolvePlanContextForDate
    // deliberately does NOT consult: a queued plan is not a target for today.
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(null);

    const ctx = await resolvePlanContextForDate("c1", "2026-05-21");

    expect(ctx).toEqual({ nutritionPlanId: null, trainingPlanId: null });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
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
