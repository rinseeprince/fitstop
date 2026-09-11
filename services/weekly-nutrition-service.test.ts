import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionDayTarget } from "./nutrition-days-service";

const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

const getNutritionTargetsForDateRangeMock = vi.fn();
vi.mock("./nutrition-days-service", () => ({
  getNutritionTargetsForDateRange: (...args: unknown[]) =>
    getNutritionTargetsForDateRangeMock(...args),
}));

import { getNutritionSummaryForPeriod } from "./weekly-nutrition-service";

/** Three logged days, each 2000 kcal. What the client ate — nothing else. */
const THREE_LOGGED_DAYS = [
  { id: "1", client_id: "c1", date: "2026-05-08", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, created_at: "", updated_at: "" },
  { id: "2", client_id: "c1", date: "2026-05-09", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, created_at: "", updated_at: "" },
  { id: "3", client_id: "c1", date: "2026-05-10", calories_consumed: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, created_at: "", updated_at: "" },
];

const PERIOD_DATES = [
  "2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11",
  "2026-05-12", "2026-05-13", "2026-05-14",
];

const target = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
  isTrainingDay: false,
  note: null,
});

function wireLogs(rows: unknown[]) {
  const builder: {
    select: ReturnType<typeof vi.fn>;
    eq: () => typeof builder;
    gte: () => typeof builder;
    lte: () => typeof builder;
    order: () => Promise<{ data: unknown[]; error: null }>;
  } = {
    select: vi.fn().mockImplementation(() => builder),
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  fromMock.mockReturnValue(builder);
  return builder;
}

/** A 2000 kcal target on every one of the seven days — what the plan prescribed. */
function wireSevenDaysOfTargets() {
  getNutritionTargetsForDateRangeMock.mockResolvedValue(
    new Map(PERIOD_DATES.map((date) => [date, target(date, 2000)]))
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
    wireLogs(THREE_LOGGED_DAYS);
    wireSevenDaysOfTargets();

    const summary = await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    expect(summary?.totalTargetCalories).toBe(14000);
    expect(Math.round(summary!.adherencePercentage!)).toBe(43);
    expect(summary?.daysOnTarget).toBe(3);
  });

  it("looks the targets up ONCE over the whole period — one batched read, never one per day", async () => {
    wireLogs(THREE_LOGGED_DAYS);
    wireSevenDaysOfTargets();

    await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    expect(getNutritionTargetsForDateRangeMock).toHaveBeenCalledTimes(1);
    expect(getNutritionTargetsForDateRangeMock).toHaveBeenCalledWith("c1", "2026-05-08", "2026-05-14");
  });

  // The food log stores what the client ate and nothing else: a logged day's
  // target is the computed day's, so the row is read for its consumed values
  // alone and a target it might once have carried is never a source.
  it("reads the log for what was eaten only, and judges each day against the computed target", async () => {
    const builder = wireLogs(
      THREE_LOGGED_DAYS.map((row) => ({ ...row, target_calories: 9999 }))
    );
    getNutritionTargetsForDateRangeMock.mockResolvedValue(
      new Map(PERIOD_DATES.map((date) => [date, target(date, 2150)]))
    );

    const summary = await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    const selected = builder.select.mock.calls[0][0] as string;
    expect(selected).not.toMatch(/target_|nutrition_adherence|calorie_surplus_deficit/);
    // 2000 against 2150 on every logged day: partial, never the row's 9999.
    expect(summary?.daysOnTarget).toBe(0);
    expect(summary?.daysUnder).toBe(3);
    expect(summary?.loggedTargetCalories).toBe(6450);
  });

  it("a period no version covers has no target and no adherence — nothing is invented", async () => {
    // The log carries no target of its own to fall back to: a client with no
    // plan is measured against nothing, which reads as no adherence figure.
    wireLogs(THREE_LOGGED_DAYS);
    getNutritionTargetsForDateRangeMock.mockResolvedValue(new Map());

    const summary = await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14");

    expect(summary?.totalTargetCalories).toBe(0);
    expect(summary?.adherencePercentage).toBeNull();
    expect(summary?.daysLogged).toBe(3);
    expect(summary?.daysOnTarget).toBe(0);
  });

  it("does not look targets up at all when the period logged nothing", async () => {
    wireLogs([]);

    expect(await getNutritionSummaryForPeriod("c1", "2026-05-08", "2026-05-14")).toBeNull();
    expect(getNutritionTargetsForDateRangeMock).not.toHaveBeenCalled();
  });
});
