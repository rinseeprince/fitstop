import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { supabaseAdmin } from "./supabase-admin";
import { fetchNutritionLogsForPeriod } from "./schedule-data-service";

function wireLogs(rows: unknown[] | null, error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte"]) chain[m] = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockResolvedValue({ data: rows, error });
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => vi.clearAllMocks());

// The food log stores what the client ate and nothing else: this read takes
// the four consumed columns and never a target or a verdict.
describe("fetchNutritionLogsForPeriod", () => {
  it("reads the consumed columns alone, over the period, for the client", async () => {
    const chain = wireLogs([
      { date: "2026-05-08", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, target_calories: 9999 },
    ]);

    const rows = await fetchNutritionLogsForPeriod("c1", "2026-05-08", "2026-05-14");

    expect(supabaseAdmin.from).toHaveBeenCalledWith("nutrition_logs");
    expect(chain.select).toHaveBeenCalledWith("date, calories_consumed, protein_g, carbs_g, fat_g");
    expect(chain.eq).toHaveBeenCalledWith("client_id", "c1");
    expect(chain.gte).toHaveBeenCalledWith("date", "2026-05-08");
    expect(chain.lte).toHaveBeenCalledWith("date", "2026-05-14");
    expect(rows).toEqual([
      { date: "2026-05-08", caloriesConsumed: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    ]);
  });

  it("surfaces a failed read", async () => {
    wireLogs(null, { message: "boom" });
    await expect(fetchNutritionLogsForPeriod("c1", "2026-05-08", "2026-05-14")).rejects.toThrow(
      "Failed to fetch nutrition logs: boom"
    );
  });
});
