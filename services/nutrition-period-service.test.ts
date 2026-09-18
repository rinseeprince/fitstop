import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionDayTarget } from "./nutrition-days-service";

vi.mock("./schedule-data-service", () => ({ fetchNutritionLogsForPeriod: vi.fn() }));
vi.mock("./nutrition-days-service", () => ({ getNutritionTargetsForDateRange: vi.fn() }));

import { fetchNutritionLogsForPeriod } from "./schedule-data-service";
import { getNutritionTargetsForDateRange } from "./nutrition-days-service";
import { getCheckInNutritionPeriod, getNutritionPeriod } from "./nutrition-period-service";
import type { NutritionDay } from "@/types/schedule";

const target = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
  isTrainingDay: false,
  note: null,
});

const log = (date: string, caloriesConsumed: number) => ({
  date,
  caloriesConsumed,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getNutritionPeriod — the live period through the kernel", () => {
  it("reads the logs and the targets ONCE over the whole range, and answers every date", async () => {
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([log("2026-05-08", 2000), log("2026-05-10", 2600)]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(
      new Map([["2026-05-08", target("2026-05-08", 2000)], ["2026-05-09", target("2026-05-09", 2000)]])
    );

    const period = await getNutritionPeriod("c1", "2026-05-08", "2026-05-10");

    expect(fetchNutritionLogsForPeriod).toHaveBeenCalledTimes(1);
    expect(fetchNutritionLogsForPeriod).toHaveBeenCalledWith("c1", "2026-05-08", "2026-05-10");
    expect(getNutritionTargetsForDateRange).toHaveBeenCalledTimes(1);
    expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith("c1", "2026-05-08", "2026-05-10");
    // Every date of the range, in order — the shape a check-in freezes.
    expect(period.days.map((day) => [day.date, day.status])).toEqual([
      ["2026-05-08", "hit"],
      ["2026-05-09", "not_logged"],
      ["2026-05-10", "no_target"],
    ]);
    // The figures are the kernel over those rows: the 10th is logged and in no ratio.
    expect(period.summary).toMatchObject({
      periodDays: 3,
      loggedDays: 2,
      targetedDays: 2,
      judgedDays: 1,
      loggedNoTargetDays: 1,
      onTarget: 1,
      daysOnTargetPct: 50,
    });
  });

  it("reads both even when the period logged nothing — the targets are the denominator", async () => {
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(new Map([["2026-05-08", target("2026-05-08", 2000)]]));

    const period = await getNutritionPeriod("c1", "2026-05-08", "2026-05-08");

    expect(getNutritionTargetsForDateRange).toHaveBeenCalledTimes(1);
    expect(period.summary).toMatchObject({ loggedDays: 0, targetedDays: 1, onTarget: 0, daysOnTargetPct: 0 });
  });
});

describe("getCheckInNutritionPeriod — a submitted check-in reads its frozen rows", () => {
  const frozen: NutritionDay[] = [
    {
      date: "2026-05-08", dayOfWeek: "friday", status: "hit",
      targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
      actualCalories: 2000, actualProteinG: 150, actualCarbsG: 200, actualFatG: 60,
    },
    {
      date: "2026-05-09", dayOfWeek: "saturday", status: "no_target",
      targetCalories: null, targetProteinG: null, targetCarbsG: null, targetFatG: null,
      actualCalories: 1800, actualProteinG: null, actualCarbsG: null, actualFatG: null,
    },
  ];

  it("hands back the snapshot's rows and the kernel over them, and reads nothing live", async () => {
    const { days, summary } = await getCheckInNutritionPeriod(
      { clientId: "c1", periodSnapshot: { generatedAt: "2026-05-10T00:00:00Z", training: [], nutrition: frozen } },
      "2026-05-08",
      "2026-05-09"
    );

    expect(fetchNutritionLogsForPeriod).not.toHaveBeenCalled();
    expect(getNutritionTargetsForDateRange).not.toHaveBeenCalled();
    expect(days).toBe(frozen);
    expect(summary).toMatchObject({ loggedDays: 2, targetedDays: 1, onTarget: 1, loggedNoTargetDays: 1, daysOnTargetPct: 100 });
  });

  it("falls back to the live period for a row with no snapshot", async () => {
    vi.mocked(fetchNutritionLogsForPeriod).mockResolvedValue([]);
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(new Map());

    const { days, summary } = await getCheckInNutritionPeriod({ clientId: "c1", periodSnapshot: undefined }, "2026-05-08", "2026-05-09");

    expect(fetchNutritionLogsForPeriod).toHaveBeenCalledWith("c1", "2026-05-08", "2026-05-09");
    expect(days).toHaveLength(2);
    expect(summary.periodDays).toBe(2);
  });
});
