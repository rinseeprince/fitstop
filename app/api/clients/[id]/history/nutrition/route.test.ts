import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { NutritionDayTarget } from "@/services/nutrition-days-service";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn().mockResolvedValue("2026-05-10"),
}));
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/services/schedule-data-service", () => ({ fetchNutritionLogsForPeriod: vi.fn() }));
vi.mock("@/services/nutrition-days-service", () => ({ getNutritionTargetsForDateRange: vi.fn() }));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { fetchNutritionLogsForPeriod } from "@/services/schedule-data-service";
import { getNutritionTargetsForDateRange } from "@/services/nutrition-days-service";
import { GET } from "./route";
import type { NutritionHistoryRow } from "@/types/history";

const params = { params: Promise.resolve({ id: "client-1" }) };
const request = () =>
  new NextRequest("http://localhost/api/clients/client-1/history/nutrition?limit=10&offset=0");

const target = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 160,
  carbsG: 210,
  fatG: 65,
  isTrainingDay: false,
  note: null,
});

/** The two earliest-activity reads: the first food log and the first version. */
function wireEarliest(firstLog: string | null, firstVersion: string | null) {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const row =
      table === "nutrition_logs"
        ? firstLog && { date: firstLog }
        : firstVersion && { effective_from: firstVersion };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: row || null, error: null });
    return chain;
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
});

// The history table: what the client ate from the log, the target for EVERY
// day from the computed day, the verdict and surplus derived from the pair.
describe("GET /api/clients/[id]/history/nutrition", () => {
  it("builds each row from the log's meals and the day's computed target, logged or not", async () => {
    wireEarliest("2026-05-08", "2026-05-01");
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([
      // A row still carrying a stale target (until migration 173): never read.
      { date: "2026-05-09", caloriesConsumed: 2000, proteinG: 150, carbsG: 200, fatG: 60, targetCalories: 9999 } as never,
    ]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(
      new Map([
        ["2026-05-09", target("2026-05-09", 2100)],
        ["2026-05-10", target("2026-05-10", 2200)],
      ])
    );

    const response = await GET(request(), params);
    const body = (await response.json()) as { rows: NutritionHistoryRow[]; total: number };

    expect(response.status).toBe(200);
    // The range runs from the earliest activity (the version's start) to the
    // coach's today; both reads cover it whole.
    expect(fetchNutritionLogsForPeriod).toHaveBeenCalledWith("client-1", "2026-05-01", "2026-05-10");
    expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith("client-1", "2026-05-01", "2026-05-10");
    expect(body.total).toBe(10);
    // Newest first: today (unlogged, a target), then the logged 9th.
    expect(body.rows[0]).toMatchObject({
      date: "2026-05-10",
      calories_consumed: null,
      target_calories: 2200,
      nutrition_adherence: null,
      calorie_surplus_deficit: null,
      is_logged: false,
    });
    expect(body.rows[1]).toMatchObject({
      date: "2026-05-09",
      calories_consumed: 2000,
      target_calories: 2100,
      target_protein_g: 160,
      nutrition_adherence: "partial",
      calorie_surplus_deficit: -100,
      is_logged: true,
    });
    // A day no version covers, logged or not, has no target and no verdict.
    expect(body.rows[2]).toMatchObject({ date: "2026-05-08", target_calories: null, nutrition_adherence: null });
  });

  it("a logged day with no target shows its meals over a dash — logged, no verdict", async () => {
    wireEarliest("2026-05-10", null);
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([
      { date: "2026-05-10", caloriesConsumed: 1800, proteinG: null, carbsG: null, fatG: null },
    ]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(new Map());

    const response = await GET(request(), params);
    const body = (await response.json()) as { rows: NutritionHistoryRow[] };

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      calories_consumed: 1800,
      target_calories: null,
      nutrition_adherence: null,
      calorie_surplus_deficit: null,
      is_logged: true,
    });
  });

  it("returns nothing for a client with no log and no version", async () => {
    wireEarliest(null, null);

    const response = await GET(request(), params);

    expect(await response.json()).toEqual({ rows: [], total: 0 });
    expect(fetchNutritionLogsForPeriod).not.toHaveBeenCalled();
    expect(getNutritionTargetsForDateRange).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(fetchNutritionLogsForPeriod).not.toHaveBeenCalled();
  });
});
