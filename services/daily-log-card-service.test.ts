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

const mockDailyLog = { id: "2026-05-21", clientId: "c1", date: "2026-05-21" } as never;

const tableQuery = (error: { message: string } | null = null) => ({
  upsert: vi.fn().mockResolvedValue({ data: null, error }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTodayLog).mockResolvedValue(mockDailyLog);
});

// The food log holds what the client ate and nothing else (owner decision
// 2026-09-11): the four consumed columns, the covering version's stamp when
// known, and updated_at. No target and no verdict is written — every reader
// takes the day's target from the computed day.
describe("upsertNutritionLog", () => {
  it("is ONE upsert on nutrition_logs keyed by (client_id, date) — the meals and the stamp, nothing else", async () => {
    const table = tableQuery();
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);

    const result = await upsertNutritionLog(
      "c1",
      "2026-05-21",
      { caloriesConsumed: 2000, proteinG: 150 },
      { nutritionPlanId: "np-1" }
    );

    expect(result).toBe(mockDailyLog);
    // No parent row is written first: the card's table is the only table touched.
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("nutrition_logs");
    const [payload, options] = table.upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: "client_id,date" });
    expect(payload).toEqual({
      client_id: "c1",
      date: "2026-05-21",
      nutrition_plan_id: "np-1",
      calories_consumed: 2000,
      protein_g: 150,
      carbs_g: null,
      fat_g: null,
      updated_at: expect.any(String),
    });
  });

  it("a day no version covers saves with no stamp — the meals go in, nothing is refused", async () => {
    const table = tableQuery();
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);

    await upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 1800 }, {
      nutritionPlanId: null,
    });

    const payload = table.upsert.mock.calls[0][0] as Record<string, unknown>;
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

  it("throws when the write fails", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(tableQuery({ message: "boom" }) as never);

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

  // A day has no parent row (migration 202). A writer that ensures one before
  // its own upsert, or keys its row by a parent id, is the two-statement shape
  // this module left behind.
  it("writes no parent row and keys nothing by a parent id", () => {
    const source = readFileSync(resolve(__dirname, "daily-log-card-service.ts"), "utf8");
    expect(source).not.toMatch(/daily_logs|daily_log_id|ensureSpine|spine/);
  });
});

describe("upsertWellnessLog", () => {
  it("is ONE upsert on wellness_logs keyed by (client_id, date), with no plan FK", async () => {
    const table = tableQuery();
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);

    const result = await upsertWellnessLog("c1", "2026-05-21", { mood: 4, energy: 7, soreness: 2 });

    expect(result).toBe(mockDailyLog);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("wellness_logs");
    expect(table.upsert).toHaveBeenCalledWith(
      {
        client_id: "c1",
        date: "2026-05-21",
        mood: 4,
        energy: 7,
        sleep: null,
        stress: null,
        soreness: 2,
        updated_at: expect.any(String),
      },
      { onConflict: "client_id,date" }
    );
  });

  it("throws when the write fails", async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(tableQuery({ message: "boom" }) as never);

    await expect(upsertWellnessLog("c1", "2026-05-21", { mood: 4 })).rejects.toThrow(
      "Failed to upsert wellness log: boom"
    );
  });
});
