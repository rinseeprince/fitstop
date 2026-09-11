import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./daily-context-service", () => ({ getPlanTargetForDate: vi.fn() }));
vi.mock("./nutrition-plan-service", () => ({ getNutritionPlanIdForDate: vi.fn() }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));
vi.mock("./daily-logs-service", async (importActual) => {
  const actual = await importActual<typeof import("./daily-logs-service")>();
  return { ...actual, getTodayLog: vi.fn() };
});

import { supabaseAdmin } from "./supabase-admin";
import { getPlanTargetForDate } from "./daily-context-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { getTodayLog } from "./daily-logs-service";
import {
  NutritionLogRerecordError,
  rerecordNutritionLogTarget,
  upsertNutritionLog,
  upsertWellnessLog,
} from "./daily-log-card-service";

const mockDailyLog = { id: "log-1", clientId: "c1", date: "2026-05-21" } as never;

const spineQuery = (id = "spine-1") => ({
  upsert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
});
const childQuery = (error: { message: string } | null = null) => ({
  upsert: vi.fn().mockResolvedValue({ data: null, error }),
});

/**
 * The nutrition_logs table as the writer and the re-record touch it: the
 * standing-row read (select → eq → eq → maybeSingle), the upsert, and the
 * update (update → eq), each answering what the test wires.
 */
function logsTable(opts: {
  standing?: Record<string, unknown> | null;
  readError?: { message: string } | null;
  upsertError?: { message: string } | null;
  updateError?: { message: string } | null;
} = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const table: Record<string, ReturnType<typeof vi.fn>> = {};
  table.select = vi.fn().mockReturnValue(table);
  table.eq = vi.fn().mockReturnValue(table);
  table.maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.standing ?? null, error: opts.readError ?? null });
  table.upsert = vi.fn().mockResolvedValue({ data: null, error: opts.upsertError ?? null });
  table.update = vi.fn().mockReturnValue({ eq: updateEq });
  return { table, updateEq };
}

const TARGET = { calories: 2100, proteinG: 160, carbsG: 210, fatG: 65, isTrainingDay: false };

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
    vi.mocked(getPlanTargetForDate).mockResolvedValue(TARGET as never);

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

  it("a day with no target and no standing log writes null targets and omits the plan link", async () => {
    const spine = spineQuery();
    const { table } = logsTable({ standing: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : table) as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(null);

    await upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 1800 }, {
      nutritionPlanId: null,
    });

    const childPayload = table.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(childPayload).not.toHaveProperty("nutrition_plan_id");
    expect(childPayload.target_calories).toBeNull();
    expect(childPayload.nutrition_adherence).toBeNull();
  });

  // Owner, 2026-09-11: a started day stays open. The coach ended or replaced
  // the plan after the client began the day, so nothing covers it now — the
  // row keeps the target it was logged under (its columns stay out of the
  // upsert, which the conflict update then preserves) and the adherence is
  // judged against that standing target, with the stamp the resolver handed
  // back from the row.
  it("a day nothing covers any more keeps the target it was logged under, and judges adherence against it", async () => {
    const spine = spineQuery();
    const { table } = logsTable({ standing: { target_calories: 2200 } });
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : table) as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(null);

    await upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 2200 }, {
      nutritionPlanId: "np-old",
    });

    expect(table.select).toHaveBeenCalledWith("target_calories");
    const childPayload = table.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(childPayload).toMatchObject({
      nutrition_plan_id: "np-old",
      calories_consumed: 2200,
      nutrition_adherence: "hit",
      calorie_surplus_deficit: 0,
    });
    for (const kept of ["target_calories", "target_protein_g", "target_carbs_g", "target_fat_g"]) {
      expect(childPayload).not.toHaveProperty(kept);
    }
  });

  it("throws when the child write fails", async () => {
    const spine = spineQuery();
    const { table } = logsTable({ upsertError: { message: "boom" } });
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "daily_logs" ? spine : table) as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(null);

    await expect(
      upsertNutritionLog("c1", "2026-05-21", { caloriesConsumed: 2000 }, {})
    ).rejects.toThrow("Failed to upsert nutrition log: boom");
  });
});

// Owner, 2026-09-11: replacing today re-records today's log. After a plan
// save whose window covers the client's today, and after a per-day edit or
// reset of today, the logged row takes the target as the day is NOW computed
// — through the SAME snapshot the client's own save writes — with the
// covering version's stamp, so every reader of the log sees the new target
// under the logged meals without waiting for the client's next save.
describe("rerecordNutritionLogTarget", () => {
  it("rewrites today's row from the day as now computed, stamped with the covering version", async () => {
    const { table, updateEq } = logsTable({ standing: { id: "row-1", calories_consumed: 2000 } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(TARGET as never);
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-new");

    expect(await rerecordNutritionLogTarget("c1", "2026-05-21")).toBe(true);

    expect(table.eq).toHaveBeenCalledWith("client_id", "c1");
    expect(table.eq).toHaveBeenCalledWith("date", "2026-05-21");
    expect(getPlanTargetForDate).toHaveBeenCalledWith("c1", "2026-05-21");
    expect(getNutritionPlanIdForDate).toHaveBeenCalledWith("c1", "2026-05-21");
    expect(table.update).toHaveBeenCalledWith(
      expect.objectContaining({
        target_calories: 2100,
        target_protein_g: 160,
        target_carbs_g: 210,
        target_fat_g: 65,
        // The row's OWN consumed calories against the new target.
        nutrition_adherence: "partial",
        calorie_surplus_deficit: -100,
        nutrition_plan_id: "np-new",
      })
    );
    expect(updateEq).toHaveBeenCalledWith("id", "row-1");
  });

  it("with no row for the day there is nothing to re-record: no read of the day, no write", async () => {
    const { table } = logsTable({ standing: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);

    expect(await rerecordNutritionLogTarget("c1", "2026-05-21")).toBe(false);

    expect(getPlanTargetForDate).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it("with no computed day now, the row keeps the target it was logged under", async () => {
    const { table } = logsTable({ standing: { id: "row-1", calories_consumed: 2000 } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(null);
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);

    expect(await rerecordNutritionLogTarget("c1", "2026-05-21")).toBe(false);
    expect(table.update).not.toHaveBeenCalled();
  });

  it("a failed rewrite is a NutritionLogRerecordError carrying the one sentence the routes report", async () => {
    const { table } = logsTable({
      standing: { id: "row-1", calories_consumed: 2000 },
      updateError: { message: "boom" },
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(table as never);
    vi.mocked(getPlanTargetForDate).mockResolvedValue(TARGET as never);
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-new");

    await expect(rerecordNutritionLogTarget("c1", "2026-05-21")).rejects.toBeInstanceOf(
      NutritionLogRerecordError
    );
    await expect(rerecordNutritionLogTarget("c1", "2026-05-21")).rejects.toThrow(
      "The change is saved, but today's food log still shows the previous target."
    );
  });

  // The rule the two writers share is only a rule while there is ONE snapshot
  // helper: the day's target reaches the log through a single read of the
  // computed day in this module, and a second one — a re-record that snapshots
  // its own way — is exactly the drift this forbids.
  it("the client's save and the coach's re-record snapshot through ONE helper", () => {
    const source = readFileSync(resolve(__dirname, "daily-log-card-service.ts"), "utf8");
    expect(source.match(/getPlanTargetForDate\(/g)).toHaveLength(1);
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
