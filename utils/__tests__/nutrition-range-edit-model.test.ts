import { describe, it, expect } from "vitest";
import type { NutritionEvent } from "@/types/check-in";
import { getDeltaBaseCalories } from "@/utils/nutrition-event-helpers";
import {
  resolveSelectedEvents,
  computeAbsoluteSeed,
  classifyAbsoluteMacros,
  applyCalorieDelta,
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
      const days = resolveSelectedEvents(
        ["2026-06-03", "2026-06-02", "2026-06-01"],
        map,
        true,
        false
      );
      expect(days.map((d) => d.date)).toEqual(["2026-06-02"]);
    });
  });

  describe("computeAbsoluteSeed", () => {
    it("uniform values seed the fields; nothing is mixed", () => {
      const map = mapOf([ev("2026-06-01"), ev("2026-06-02")]);
      const seed = computeAbsoluteSeed(
        resolveSelectedEvents(["2026-06-01", "2026-06-02"], map, true, false)
      );
      expect(seed.calories).toEqual({ value: "2000", mixed: false });
      expect(seed.protein).toEqual({ value: "150", mixed: false });
      expect(seed.dietType).toBe("balanced");
      expect(seed.calorieRange).toBeNull();
    });

    it("mixed calories blank the field and expose the displayed min–max range", () => {
      // Surplus stacks into the displayed value: 2000 vs round(2000 * 1.1) = 2200.
      const map = mapOf([
        ev("2026-06-01"),
        ev("2026-06-02", { calorieSurplusPercentage: 10, isTrainingDay: true }),
      ]);
      const seed = computeAbsoluteSeed(
        resolveSelectedEvents(["2026-06-01", "2026-06-02"], map, true, false)
      );
      expect(seed.calories.mixed).toBe(true);
      expect(seed.calories.value).toBe("");
      expect(seed.calorieRange).toEqual({ min: 2000, max: 2200 });
    });

    it("mixed diet types disable the uniform dietType", () => {
      const map = mapOf([ev("2026-06-01"), ev("2026-06-02", { dietType: "keto" })]);
      const seed = computeAbsoluteSeed(
        resolveSelectedEvents(["2026-06-01", "2026-06-02"], map, true, false)
      );
      expect(seed.dietType).toBeNull();
    });
  });

  describe("classifyAbsoluteMacros", () => {
    it("maps blank/filled combinations to the server's materialize semantics", () => {
      expect(classifyAbsoluteMacros("150", "200", "60")).toBe("verbatim");
      expect(classifyAbsoluteMacros("150", "", "")).toBe("protein-only");
      expect(classifyAbsoluteMacros("", "", "")).toBe("auto");
      // A lone carbs or fat value would be silently ignored server-side.
      expect(classifyAbsoluteMacros("", "200", "")).toBe("invalid");
      expect(classifyAbsoluteMacros("150", "", "60")).toBe("invalid");
    });
  });

  describe("delta math mirrors the server", () => {
    it("getDeltaBaseCalories stacks the surplus regardless of the burn toggle", () => {
      expect(getDeltaBaseCalories(ev("d", { calorieSurplusPercentage: 10 }))).toBe(2200);
      expect(getDeltaBaseCalories(ev("d", { trainingBurnCalories: 300 }))).toBe(2300);
      expect(getDeltaBaseCalories(ev("d"))).toBe(2000);
    });

    it("applyCalorieDelta matches the server's single-round formula", () => {
      expect(applyCalorieDelta(2200, { percent: -50 })).toBe(1100);
      expect(applyCalorieDelta(2200, { percent: -10 })).toBe(1980);
      expect(applyCalorieDelta(2200, { calorieDelta: -200 })).toBe(2000);
      expect(applyCalorieDelta(2946, { calorieDelta: -200 })).toBe(2746);
    });

    it("floors at zero — a wild negative delta never previews negative calories", () => {
      expect(applyCalorieDelta(2200, { calorieDelta: -5000 })).toBe(0);
      expect(applyCalorieDelta(2200, { percent: -200 })).toBe(0);
    });
  });

  describe("averageDisplayedCalories", () => {
    it("averages the resolved days' displayed calories; null when nothing resolves", () => {
      const map = mapOf([
        ev("2026-06-01"),
        ev("2026-06-02", { calorieSurplusPercentage: 10, isTrainingDay: true }),
      ]);
      const days = resolveSelectedEvents(["2026-06-01", "2026-06-02"], map, true, false);
      expect(averageDisplayedCalories(days)).toBe(2100); // (2000 + 2200) / 2
      expect(averageDisplayedCalories([])).toBeNull();
    });
  });
});
