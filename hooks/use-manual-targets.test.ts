import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useManualTargets } from "./use-manual-targets";
import {
  gramsToCalories,
  gramsToSplit,
  splitToGrams,
  type MacroSplit,
} from "@/lib/nutrition/macro-balance";

// Coherent by construction (198*4 + 250*4 + 79*9 = 2503), as the real auto
// calculator's output is — it derives the grams FROM the calorie target.
const AUTO = { calories: 2503, proteinG: 198, carbG: 250, fatG: 79 };

const kcalOf = (t: { proteinG: number; carbG: number; fatG: number }) => gramsToCalories(t);

describe("useManualTargets", () => {
  it("seeds the balancer from the live auto result: the calories exactly, the split off its grams", () => {
    const { result } = renderHook(() => useManualTargets(null));
    act(() => result.current.enableManualTargets(AUTO));

    expect(result.current.manualEnabled).toBe(true);
    expect(result.current.manualBalance).toEqual({
      calories: 2503,
      split: gramsToSplit(AUTO),
    });
    // What Generate would post: the target, and the grams the split derives —
    // within one percent of the auto grams (the whole-percent snap) and within
    // one carb rounding of the target.
    const t = result.current.manualTargets!;
    expect(t.calories).toBe(2503);
    expect(Math.abs(t.proteinG - AUTO.proteinG)).toBeLessThanOrEqual(3);
    expect(Math.abs(t.carbG - AUTO.carbG)).toBeLessThanOrEqual(3);
    expect(Math.abs(t.fatG - AUTO.fatG)).toBeLessThanOrEqual(2);
    expect(Math.abs(kcalOf(t) - 2503)).toBeLessThanOrEqual(2);
  });

  describe("the gate is at submit, not on the keyboard", () => {
    it("an emptied calorie field is reported, not blocked — and the split survives it", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      const split = result.current.manualBalance.split;
      act(() => result.current.setManualBalance({ calories: null, split }));

      expect(result.current.manualBalance.calories).toBeNull();
      expect(result.current.manualBalance.split).toEqual(split);
      expect(result.current.manualBlockingError).toBe("Enter a calorie target");
      expect(result.current.manualTargets).toBeNull();

      // Still editable — the error is information, not a lock.
      act(() => result.current.setManualBalance({ calories: 2400, split }));
      expect(result.current.manualBlockingError).toBeNull();
      expect(result.current.manualTargets).toEqual({ calories: 2400, ...splitToGrams(2400, split) });
    });

    it("the four numbers cannot disagree: every target it emits sums to its calories within a carb rounding", () => {
      const { result } = renderHook(() => useManualTargets(null));
      const split: MacroSplit = { carbs: 45, fat: 25, protein: 30 };
      for (const calories of [1500, 2400, 3333]) {
        act(() => result.current.setManualBalance({ calories, split }));
        act(() => {
          if (!result.current.manualEnabled) result.current.enableManualTargets(AUTO);
        });
        act(() => result.current.setManualBalance({ calories, split }));
        const t = result.current.manualTargets!;
        expect(t.calories).toBe(calories);
        expect(Math.abs(kcalOf(t) - calories)).toBeLessThanOrEqual(2);
      }
    });

    it("is silent when manual mode is off", () => {
      const { result } = renderHook(() => useManualTargets(null));
      expect(result.current.manualBlockingError).toBeNull();
      expect(result.current.manualTargets).toBeNull();
    });
  });

  // A picker change recomposes the split, holding the calorie target. The
  // pickers above the balancer have no control of their own on it (diet type
  // = a carb:fat ratio, protein-per-kg = a protein figure), so in manual mode
  // they were inert. Fired ONLY on a deliberate picker change.
  describe("a picker change recomposes the split, holding the calorie target", () => {
    it("a diet-type change moves fat up and carbs down for low_carb; protein and calories held", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      const before = result.current.manualBalance.split;
      act(() => result.current.recomposeManualMacros({ dietType: "low_carb" }));

      const { calories, split } = result.current.manualBalance;
      expect(calories).toBe(AUTO.calories);
      expect(split.protein).toBe(before.protein);
      // Low carb is 25 / 75 of the calories after protein.
      expect(split.fat).toBeGreaterThan(before.fat);
      expect(split.carbs).toBeLessThan(before.carbs);
      expect(split.carbs + split.fat + split.protein).toBe(100);
    });

    it("a protein-per-kg change moves the protein share to the new grams and re-splits the rest; calories held", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      // The builder derives the new protein from the calculator; here we pass a
      // higher figure directly (the hook does not know about g/kg).
      act(() => result.current.recomposeManualMacros({ proteinG: 240, dietType: "balanced" }));

      const t = result.current.manualTargets!;
      expect(t.calories).toBe(AUTO.calories); // the coach's calorie target is held
      // 240 g at 2,503 kcal is 38.4% → 38% → 238 g: within a percent of the target.
      expect(Math.abs(t.proteinG - 240)).toBeLessThanOrEqual(3);
      expect(Math.abs(kcalOf(t) - AUTO.calories)).toBeLessThanOrEqual(2);
      // Balanced: carbs and fat share the rest 50 / 50 by calories.
      expect(result.current.manualBalance.split.carbs).toBe(result.current.manualBalance.split.fat);
    });

    it("the custom diet type is no ratio — the coach's own split stands", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      const before = result.current.manualBalance.split;
      act(() => result.current.recomposeManualMacros({ dietType: "custom" }));
      expect(result.current.manualBalance.split).toEqual(before);
    });

    it("is a no-op while the calorie field is empty", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      const split = result.current.manualBalance.split;
      act(() => result.current.setManualBalance({ calories: null, split }));
      act(() => result.current.recomposeManualMacros({ dietType: "low_carb" }));

      expect(result.current.manualBalance).toEqual({ calories: null, split });
    });
  });

  it("hydrates from a stored manual override and starts in manual mode", () => {
    const stored = { customProteinG: 180, customCarbG: 200, customFatG: 62 };
    const { result } = renderHook(() =>
      useManualTargets({ customMacrosEnabled: true, customCalories: 2078, ...stored })
    );

    expect(result.current.manualEnabled).toBe(true);
    expect(result.current.manualBalance).toEqual({
      calories: 2078,
      split: gramsToSplit({ proteinG: 180, carbG: 200, fatG: 62 }),
    });
    // The drawer reopens on the saved numbers: calories exact, grams within the
    // whole-percent snap of what was stored.
    const t = result.current.manualTargets!;
    expect(t.calories).toBe(2078);
    expect(Math.abs(t.proteinG - 180)).toBeLessThanOrEqual(3);
    expect(Math.abs(t.carbG - 200)).toBeLessThanOrEqual(3);
    expect(Math.abs(t.fatG - 62)).toBeLessThanOrEqual(2);
  });

  it("revert to auto leaves manual mode", () => {
    const { result } = renderHook(() => useManualTargets(null));
    act(() => result.current.enableManualTargets(AUTO));
    act(() => result.current.revertToAuto());
    expect(result.current.manualEnabled).toBe(false);
    expect(result.current.manualBlockingError).toBeNull();
  });
});
