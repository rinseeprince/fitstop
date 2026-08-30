import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

const fetchNutritionDataForPeriodMock = vi.fn();
vi.mock("./schedule-data-service", () => ({
  fetchNutritionDataForPeriod: (...args: unknown[]) =>
    fetchNutritionDataForPeriodMock(...args),
}));

const getNutritionEventsForDateRangeMock = vi.fn();
vi.mock("./nutrition-event-service", () => ({
  getNutritionEventsForDateRange: (...args: unknown[]) =>
    getNutritionEventsForDateRangeMock(...args),
}));

const buildNutritionSummaryMock = vi.fn();
vi.mock("@/utils/nutrition-period-summary", () => ({
  buildNutritionSummary: (...args: unknown[]) => buildNutritionSummaryMock(...args),
}));

import { getNutritionSummaryForPeriod } from "./weekly-nutrition-service";

/** Three logged days, each 2000 kcal against a 2000 kcal target. */
const THREE_PERFECT_LOGGED_DAYS = [
  { id: "1", client_id: "c1", date: "2026-05-08", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, target_calories: 2000, target_protein_g: 150, target_carbs_g: 200, target_fat_g: 60, created_at: "", updated_at: "" },
  { id: "2", client_id: "c1", date: "2026-05-09", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, target_calories: 2000, target_protein_g: 150, target_carbs_g: 200, target_fat_g: 60, created_at: "", updated_at: "" },
  { id: "3", client_id: "c1", date: "2026-05-10", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, target_calories: 2000, target_protein_g: 150, target_carbs_g: 200, target_fat_g: 60, created_at: "", updated_at: "" },
];

function wireLogs(rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  fromMock.mockReturnValue(builder);
}

/** A target on every one of the seven days — what the plan prescribed. */
function wireSevenDaysOfTargets() {
  fetchNutritionDataForPeriodMock.mockResolvedValue({ plans: [], nutritionLogs: [] });
  getNutritionEventsForDateRangeMock.mockResolvedValue([]);
  buildNutritionSummaryMock.mockReturnValue(
    Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-0${8 + i}`,
      targetCalories: 2000,
      targetProteinG: 150,
      targetCarbsG: 200,
      targetFatG: 60,
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getNutritionSummaryForPeriod", () => {
  it("scores consumption against the WHOLE period's targets, not the logged days'", async () => {
    // #5's headline case. Three logged days, each exactly on target, out of a
    // seven-day period: 6000 consumed against 14000 prescribed is ~43%. The old
    // behaviour summed only the logged days' targets — 6000/6000 — and reported
    // a client who ignored four days as 100% adherent.
    wireLogs(THREE_PERFECT_LOGGED_DAYS);
    wireSevenDaysOfTargets();

    const summary = await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    expect(summary?.totalTargetCalories).toBe(14000);
    expect(Math.round(summary!.adherencePercentage!)).toBe(43);
  });

  it("builds those targets over every date in the period", async () => {
    wireLogs(THREE_PERFECT_LOGGED_DAYS);
    wireSevenDaysOfTargets();

    await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    const [dates] = buildNutritionSummaryMock.mock.calls[0];
    expect(dates).toEqual([
      "2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11",
      "2026-05-12", "2026-05-13", "2026-05-14",
    ]);
  });

  it("falls back to the logged days' own targets when the period has none", async () => {
    // A client with no plan and no events has nothing to be measured against.
    // Inventing a zero target would read as infinite adherence; the previous
    // behaviour is the honest answer.
    wireLogs(THREE_PERFECT_LOGGED_DAYS);
    fetchNutritionDataForPeriodMock.mockResolvedValue({ plans: [], nutritionLogs: [] });
    getNutritionEventsForDateRangeMock.mockResolvedValue([]);
    buildNutritionSummaryMock.mockReturnValue(
      Array.from({ length: 7 }, () => ({
        targetCalories: null, targetProteinG: null, targetCarbsG: null, targetFatG: null,
      })),
    );

    const summary = await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    expect(summary?.totalTargetCalories).toBe(6000);
  });

  it("does not build targets at all when the period logged nothing", async () => {
    // Three extra selects for a period with no rows to score would be waste.
    wireLogs([]);

    expect(await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14")).toBeNull();
    expect(fetchNutritionDataForPeriodMock).not.toHaveBeenCalled();
  });
});
