import { describe, it, expect } from "vitest";
import { buildPeriodSnapshot, countTargetedDays, readPeriodSnapshot } from "./period-snapshot";
import type { NutritionDay } from "@/types/schedule";

const day = (date: string, targetCalories: number | null, actualCalories: number | null): NutritionDay => ({
  date, dayOfWeek: "monday", status: targetCalories == null ? "no_target" : actualCalories == null ? "not_logged" : "hit",
  targetCalories, targetProteinG: null, targetCarbsG: null, targetFatG: null,
  actualCalories, actualProteinG: null, actualCarbsG: null, actualFatG: null,
});

describe("the period snapshot", () => {
  it("is the training schedule and the kernel's rows, stamped", () => {
    const snapshot = buildPeriodSnapshot([], [day("2026-05-08", 2000, 2000)], "2026-05-10T00:00:00Z");
    expect(snapshot).toEqual({ generatedAt: "2026-05-10T00:00:00Z", training: [], nutrition: [day("2026-05-08", 2000, 2000)] });
  });

  it("reads back only a value shaped like one", () => {
    expect(readPeriodSnapshot(null)).toBeNull();
    expect(readPeriodSnapshot(undefined)).toBeNull();
    expect(readPeriodSnapshot("x")).toBeNull();
    expect(readPeriodSnapshot({ training: [] })).toBeNull();
    expect(readPeriodSnapshot({ generatedAt: "t", training: [], nutrition: [] })).toEqual({ generatedAt: "t", training: [], nutrition: [] });
  });

  // The stored on-target count is over the days a target was prescribed, so
  // that is the denominator the client's card shows it against — logged or not.
  it("counts the frozen rows that carried a target as the stored count's denominator", () => {
    const snapshot = buildPeriodSnapshot([], [
      day("2026-05-08", 2000, 2000),
      day("2026-05-09", 2000, null),
      day("2026-05-10", null, 1800),
    ]);
    expect(countTargetedDays(snapshot)).toBe(2);
    expect(countTargetedDays(undefined)).toBeNull();
  });
});
