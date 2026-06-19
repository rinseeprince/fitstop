import { describe, it, expect } from "vitest";
import {
  percentToGrams,
  macroCalories,
  gramsToPercent,
} from "../custom-macro-conversion";

describe("custom-macro-conversion", () => {
  describe("percentToGrams", () => {
    it("converts 2000 kcal @ 30/40/30 to 150/200/67g (spec example)", () => {
      expect(percentToGrams(2000, 30, 40)).toEqual({ protein: 150, carbs: 200, fat: 67 });
    });

    it("auto-fills fat% as 100 - P - C", () => {
      // P 40, C 40 -> fat 20%: protein 200, carbs 200, fat 44
      expect(percentToGrams(2000, 40, 40)).toEqual({ protein: 200, carbs: 200, fat: 44 });
    });

    it("clamps fat% at 0 when P + C exceeds 100", () => {
      const g = percentToGrams(2000, 70, 50); // fat% -> 0
      expect(g.fat).toBe(0);
    });
  });

  describe("macroCalories", () => {
    it("re-totals grams via 4/4/9", () => {
      expect(macroCalories({ protein: 150, carbs: 200, fat: 67 })).toBe(2003);
    });
  });

  describe("gramsToPercent", () => {
    it("derives the split from grams, fat% absorbing rounding to sum 100", () => {
      const pct = gramsToPercent({ protein: 150, carbs: 200, fat: 67 }, 2000);
      expect(pct.proteinPct + pct.carbPct + pct.fatPct).toBe(100);
      expect(pct.proteinPct).toBe(30);
      expect(pct.carbPct).toBe(40);
    });

    it("falls back to macro-derived total when calories is 0", () => {
      const pct = gramsToPercent({ protein: 150, carbs: 200, fat: 67 }, 0);
      expect(pct.proteinPct + pct.carbPct + pct.fatPct).toBe(100);
    });

    it("returns zeros for an empty plan", () => {
      expect(gramsToPercent({ protein: 0, carbs: 0, fat: 0 }, 0)).toEqual({
        proteinPct: 0,
        carbPct: 0,
        fatPct: 0,
      });
    });
  });

  describe("round-trip", () => {
    it("grams -> percent -> grams is stable for the spec example", () => {
      const grams = percentToGrams(2000, 30, 40);
      const pct = gramsToPercent(grams, 2000);
      const back = percentToGrams(2000, pct.proteinPct, pct.carbPct);
      expect(back).toEqual(grams);
    });
  });
});
