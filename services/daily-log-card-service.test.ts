import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./daily-logs-service", async (importActual) => {
  const actual = await importActual<typeof import("./daily-logs-service")>();
  return { ...actual, getTodayLog: vi.fn() };
});

import { supabaseAdmin } from "./supabase-admin";
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

// The food log holds what the client ate and nothing else (owner decision
// 2026-09-11): the spine link, the four consumed columns, the covering
// version's stamp when known, and updated_at. No target and no verdict is
// written — every reader takes the day's target from the computed day.
describe("upsertNutritionLog", () => {
  it("ensures the spine, then writes the meals and the stamp — and nothing else", async () => {
    const spine = spineQuery();
    const child = childQuery();
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);

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
    const [payload, options] = child.upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: "daily_log_id" });
    expect(payload).toEqual({
      daily_log_id: "spine-1",
      client_id: "c1",
      date: "2026-05-21",
      nutrition_plan_id: "np-1",
      calories_consumed: 2000,
      protein_g: 150,
      carbs_g: null,
      fat_g: null,
      updated_at: expect.any(String),
    });
    // The row is only ever read by the day readers; nothing is looked up here.
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("a day no version covers saves with no stamp — the meals go in, nothing is refused", async () => {
    const spine = spineQuery();
    const child = childQuery();
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);

    await upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 1800 }, {
      nutritionPlanId: null,
    });

    const payload = child.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("nutrition_plan_id");
    expect(payload.calories_consumed).toBe(1800);
    for (const never of [
      "target_calories",
      "target_protein_g",
      "target_carbs_g",
      "target_fat_g",
      "nutrition_adherence",
      "calorie_surplus_deficit",
    ]) {
      expect(payload).not.toHaveProperty(never);
    }
  });

  it("throws when the child write fails", async () => {
    const spine = spineQuery();
    const child = childQuery({ message: "boom" });
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : child) as never);

    await expect(
      upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 2000 }, {})
    ).rejects.toThrow("Failed to upsert nutrition log: boom");
  });

  // The writer knows nothing about targets: it reads no computed day and
  // derives no verdict. A target column written here again — or a target
  // looked up to write it — is the copy this module exists not to keep.
  it("reads no target and writes no target column", () => {
    const source = readFileSync(resolve(__dirname, "daily-log-card-service.ts"), "utf8");
    expect(source).not.toMatch(
      /getPlanTargetForDate|getNutritionTargetsForDateRange|calculateNutritionAdherence|calculateCalorieSurplusDeficit|target_calories|target_protein_g|target_carbs_g|target_fat_g|nutrition_adherence|calorie_surplus_deficit/
    );
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
