import { describe, it, expect } from "vitest";
import type { NutritionEvent } from "@/types/check-in";
import {
  resolveSelectedEvents,
  computeAbsoluteSeed,
  averageDisplayedCalories,
} from "@/utils/nutrition-range-edit-model";

type EvOverrides = Partial<NutritionEvent>;

function ev(date: string, overrides: EvOverrides = {}): NutritionEvent {
  return {
    id: `ne-${date}`,
    clientId: "c1",
    nutritionPlanId: "np-1",
    date,
    dayOfWeek: "monday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 60,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as NutritionEvent;
}

function mapOf(events: NutritionEvent[]): Map<string, NutritionEvent> {
  return new Map(events.map((e) => [e.date, e]));
}

describe("nutrition-range-edit-model", () => {
  describe("resolveSelectedEvents", () => {
    it("drops missing and non-scheduled dates, sorts by date", () => {
      const map = mapOf([ev("2026-06-02"), ev("2026-06-01", { status: "logged" })]);
      const days = resolveSelectedEvents(["2026-06-03", "2026-06-02", "2026-06-01"], map);
      expect(days.map((d) => d.date)).toEqual(["2026-06-02"]);
    });
  });

  // The balancer opens on the FIRST selected day's numbers and applies one
  // target to every selected day (owner decision 2026-09-10).
  describe("computeAbsoluteSeed", () => {
    it("seeds the calories and grams from the first selected day; equal days expose no range", () => {
      const map = mapOf([ev("2026-06-01"), ev("2026-06-02")]);
      const seed = computeAbsoluteSeed(
        resolveSelectedEvents(["2026-06-01", "2026-06-02"], map)
      );
      expect(seed.calories).toBe(2000);
      expect(seed.grams).toEqual({ proteinG: 150, carbG: 200, fatG: 60 });
      expect(seed.calorieRange).toBeNull();
    });

    it("days that differ still seed from the first, and expose the displayed min–max range", () => {
      // Surplus stacks into the displayed value: 2000 vs round(2000 * 1.1) = 2200.
      const map = mapOf([
        ev("2026-06-01"),
        ev("2026-06-02", { calorieSurplusPercentage: 10, isTrainingDay: true }),
      ]);
      const seed = computeAbsoluteSeed(
        resolveSelectedEvents(["2026-06-01", "2026-06-02"], map)
      );
      expect(seed.calories).toBe(2000);
      expect(seed.calorieRange).toEqual({ min: 2000, max: 2200 });
    });

    it("the first day is the first by DATE, whatever order the selection was made in", () => {
      const map = mapOf([
        ev("2026-06-01", { baselineCalories: 1800 }),
        ev("2026-06-02", { baselineCalories: 2200 }),
      ]);
      const seed = computeAbsoluteSeed(
        resolveSelectedEvents(["2026-06-02", "2026-06-01"], map)
      );
      expect(seed.calories).toBe(1800);
      expect(seed.calorieRange).toEqual({ min: 1800, max: 2200 });
    });

    it("nothing selected seeds nothing", () => {
      expect(computeAbsoluteSeed([])).toEqual({ calories: null, grams: null, calorieRange: null });
    });
  });

  describe("averageDisplayedCalories", () => {
    it("averages the resolved days' displayed calories; null when nothing resolves", () => {
      const map = mapOf([
        ev("2026-06-01"),
        ev("2026-06-02", { calorieSurplusPercentage: 10, isTrainingDay: true }),
      ]);
      const days = resolveSelectedEvents(["2026-06-01", "2026-06-02"], map);
      expect(averageDisplayedCalories(days)).toBe(2100); // (2000 + 2200) / 2
      expect(averageDisplayedCalories([])).toBeNull();
    });
  });
});
