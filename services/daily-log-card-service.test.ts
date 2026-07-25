import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./daily-context-service", () => ({ getPlanTargetForDate: vi.fn() }));
vi.mock("./daily-logs-service", async (importActual) => {
  const actual = await importActual<typeof import("./daily-logs-service")>();
  return { ...actual, getTodayLog: vi.fn() };
});

import { supabaseAdmin } from "./supabase-admin";
import { getPlanTargetForDate } from "./daily-context-service";
import { getTodayLog } from "./daily-logs-service";
import { upsertNutritionLog, upsertWellnessLog } from "./daily-log-card-service";

const mockDailyLog = { id: "log-1", clientId: "c1", date: "2026-05-21" } as never;

const spineQuery = (id = "spine-1") => ({
  upsert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
});
const childQuery = (error: { message: string } | null = null) => ({
  upsert: vi.fn().mockResolvedValue({ data: null, error }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTodayLog).mockResolvedValue(mockDailyLog);
});

describe("upsertNutritionLog", () => {
  it("ensures the spine, snapshots targets, writes nutrition_logs", async () => {
    const spine = spineQuery();
    const child = childQuery();
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue({
      calories: 2100, proteinG: 160, carbsG: 210, fatG: 65, isTrainingDay: false,
    } as never);

    const result = await upsertNutritionLog(
      "c1",
      "2026-05-21",
      { caloriesConsumed: 2000, proteinG: 150 },
      { nutritionPlanId: "np-1" }
    );

    expect(result).toBe(mockDailyLog);
    expect(spine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "c1", date: "2026-05-21" }),
      { onConflict: "client_id,date" }
    );
    expect(child.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        daily_log_id: "spine-1",
        client_id: "c1",
        date: "2026-05-21",
        nutrition_plan_id: "np-1",
        calories_consumed: 2000,
        protein_g: 150,
        target_calories: 2100,
        // The macro targets snapshotted into the frozen log come straight from
        // getPlanTargetForDate — which now applies the surplus-split (D-C), so a
        // new log captures split-consistent macros.
        target_protein_g: 160,
        target_carbs_g: 210,
        target_fat_g: 65,
        nutrition_adherence: "partial", // |2000-2100| = 100 → partial
        calorie_surplus_deficit: -100,
      }),
      { onConflict: "daily_log_id" }
    );
  });

  it("omits nutrition_plan_id from the payload when none resolved", async () => {
    const spine = spineQuery();
    const child = childQuery();
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(null);

    await upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 1800 }, {
      nutritionPlanId: null,
    });

    const childPayload = child.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(childPayload).not.toHaveProperty("nutrition_plan_id");
    expect(childPayload.target_calories).toBeNull();
    expect(childPayload.nutrition_adherence).toBeNull();
  });

  it("throws when the child write fails", async () => {
    const spine = spineQuery();
    const child = childQuery({ message: "boom" });
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(null);

    await expect(
      upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 2000 }, {})
    ).rejects.toThrow("Failed to upsert nutrition log: boom");
  });
});

describe("upsertWellnessLog", () => {
  it("ensures the spine and writes wellness_logs (no plan FK)", async () => {
    const spine = spineQuery();
    const child = childQuery();
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);

    const result = await upsertWellnessLog("c1", "2026-05-21", { mood: 4, energy: 7, soreness: 2 });

    expect(result).toBe(mockDailyLog);
    expect(spine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "c1", date: "2026-05-21" }),
      { onConflict: "client_id,date" }
    );
    expect(child.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        daily_log_id: "spine-1",
        mood: 4,
        energy: 7,
        sleep: null,
        stress: null,
        soreness: 2,
      }),
      { onConflict: "daily_log_id" }
    );
    expect(child.upsert.mock.calls[0][0]).not.toHaveProperty("nutrition_plan_id");
  });
});
