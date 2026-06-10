import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

vi.mock("./training-service", () => ({
  getActiveTrainingPlan: vi.fn().mockResolvedValue(null),
}));

vi.mock("./training-event-service", () => ({
  getEventsForDateRange: vi.fn().mockResolvedValue([]),
}));

vi.mock("./nutrition-plan-service", () => ({
  promoteNutritionPlanIfReady: vi.fn().mockResolvedValue({ promoted: false }),
}));

vi.mock("@/utils/build-daily-targets", () => ({
  buildDailyTargetsFromPlan: vi.fn().mockReturnValue([]),
}));

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getClientTodayString } from "./today-service";
import { getEventsForDateRange } from "./training-event-service";
import { getClientNutritionTargets } from "./client-portal-service";

function createMockQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: undefined as unknown,
  };
  Object.defineProperty(query, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return query;
}

describe("getClientNutritionTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anchors the live training week to the CLIENT's local today", async () => {
    // The client's local day is Wednesday 2026-06-10 — possibly a different
    // day (or week) than the server's UTC clock. The live-week window for
    // calorie enrichment must derive from the client's day.
    vi.mocked(getClientTodayString).mockResolvedValue("2026-06-10");

    const clientQuery = createMockQuery({
      data: { include_activity_burn: true, unit_preference: "metric" },
      error: null,
    });
    const planQuery = createMockQuery({
      data: {
        id: "plan-1",
        diet_type: "balanced",
        custom_macros_enabled: false,
        custom_calories: null,
        custom_protein_g: null,
        custom_carb_g: null,
        custom_fat_g: null,
        baseline_calories: 2200,
        protein_target_g: 170,
        carb_target_g: 240,
        fat_target_g: 70,
      },
      error: null,
    });
    const targetsQuery = createMockQuery({ data: [], error: null });

    let call = 0;
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      from: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) return clientQuery;
        if (call === 2) return planQuery;
        return targetsQuery;
      }),
    } as never);

    const result = await getClientNutritionTargets("client-1");

    expect(result).not.toBeNull();
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    // 2026-06-10 is a Wednesday: Monday-anchored week = 06-08 .. 06-14.
    expect(getEventsForDateRange).toHaveBeenCalledWith(
      "client-1",
      "2026-06-08",
      "2026-06-14",
    );
  });
});
