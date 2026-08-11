import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useManualTargets, completeTargets, macroCalories } from "./use-manual-targets";

// Coherent by construction (198*4 + 250*4 + 79*9 = 2503), as the real auto
// calculator's output is — it derives the grams FROM the calorie target, so
// only rounding separates the two.
const AUTO = { calories: 2503, proteinG: 198, carbG: 250, fatG: 79 };

describe("useManualTargets", () => {
  it("seeds from the live auto result, never from zeros", () => {
    const { result } = renderHook(() => useManualTargets(null));
    act(() => result.current.enableManualTargets(AUTO));

    expect(result.current.manualEnabled).toBe(true);
    expect(result.current.manualDraft).toEqual(AUTO);
  });

  // =========================================================================
  // The bug this hook was rewritten for.
  //
  // Fields used to re-derive each other on EVERY keystroke, over values that
  // were coerced from "" to 0. Clearing carbs therefore rewrote the calorie
  // field, and typing a new calorie target was then impossible: each
  // intermediate keystroke ("2" of "2400") fell below the protein floor, got
  // clamped, and snapped the field straight back.
  // =========================================================================
  describe("typing never mutates a field the coach is not editing", () => {
    it("clearing carbs leaves calories, protein and fat exactly as they were", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.setManualField("carbG", null));

      expect(result.current.manualDraft.carbG).toBeNull();
      expect(result.current.manualDraft.calories).toBe(AUTO.calories);
      expect(result.current.manualDraft.proteinG).toBe(AUTO.proteinG);
      expect(result.current.manualDraft.fatG).toBe(AUTO.fatG);
    });

    it("an empty field is null, NOT zero", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.setManualField("fatG", null));

      expect(result.current.manualDraft.fatG).toBeNull();
      expect(result.current.manualDraft.fatG).not.toBe(0);
    });

    it("accepts every intermediate value while typing a calorie target digit by digit", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      // Clear carbs and fat first — the exact state that used to trap the coach.
      act(() => result.current.setManualField("carbG", null));
      act(() => result.current.setManualField("fatG", null));

      for (const keystroke of [2, 24, 240, 2400]) {
        act(() => result.current.setManualField("calories", keystroke));
        expect(result.current.manualDraft.calories).toBe(keystroke);
      }
      // And the macros were not silently rewritten along the way.
      expect(result.current.manualDraft.carbG).toBeNull();
      expect(result.current.manualDraft.fatG).toBeNull();
    });
  });

  describe("the gate is at submit, not on the keyboard", () => {
    it("reports an incomplete draft without preventing further edits", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.setManualField("carbG", null));

      expect(result.current.manualBlockingError).toMatch(/all four are required/);
      expect(result.current.manualTargets).toBeNull();

      // Still editable — the error is information, not a lock.
      act(() => result.current.setManualField("carbG", 250));
      expect(result.current.manualBlockingError).toBeNull();
      expect(result.current.manualTargets).toEqual(AUTO);
    });

    it("flags macros that disagree with the entered calorie target", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.setManualField("calories", 3500));

      expect(result.current.manualCaloriesMismatch).toBe(true);
      expect(result.current.manualBlockingError).toMatch(/does not match/);
      // Refuses to post an incoherent override.
      expect(result.current.manualTargets).toBeNull();
    });

    it("resolves that mismatch on request, holding protein", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.setManualField("calories", 3500));
      act(() => result.current.matchMacrosToCalories());

      const d = result.current.manualDraft;
      expect(d.proteinG).toBe(AUTO.proteinG);
      expect(result.current.manualCaloriesMismatch).toBe(false);
      expect(result.current.manualBlockingError).toBeNull();
      expect(macroCalories(completeTargets(d)!)).toBeCloseTo(3500, -2);
    });

    it("is silent when manual mode is off", () => {
      const { result } = renderHook(() => useManualTargets(null));
      expect(result.current.manualBlockingError).toBeNull();
    });
  });

  // =========================================================================
  // A diet-type change re-splits the manual macros (Option B).
  //
  // The diet-type picker has no editable box of its own, so in manual mode it
  // was inert — a coach changing "Balanced" to "Low Carb" saw the boxes stay
  // put. `resplitManualByDietType` (fired ONLY on a deliberate picker change,
  // never on a keystroke) holds calories and protein and re-derives carbs/fat
  // from the diet split, so the boxes follow the picker.
  // =========================================================================
  describe("a diet-type change re-splits carbs/fat, holding calories and protein", () => {
    it("moves fat up and carbs down for low_carb, keeping the calorie total", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.resplitManualByDietType("low_carb"));

      const d = result.current.manualDraft;
      // Calories and protein are untouched.
      expect(d.calories).toBe(AUTO.calories);
      expect(d.proteinG).toBe(AUTO.proteinG);
      // Low carb (25/75 carb/fat of the post-protein calories) pushes fat up and
      // carbs down from the balanced seed.
      expect(d.fatG!).toBeGreaterThan(AUTO.fatG);
      expect(d.carbG!).toBeLessThan(AUTO.carbG);
      // The re-split stays coherent with the calorie target (no mismatch left).
      expect(result.current.manualCaloriesMismatch).toBe(false);
      expect(macroCalories(completeTargets(d)!)).toBeCloseTo(AUTO.calories, -2);
    });

    it("is a no-op while calories or protein is mid-edit (null)", () => {
      const { result } = renderHook(() => useManualTargets(null));
      act(() => result.current.enableManualTargets(AUTO));
      act(() => result.current.setManualField("calories", null));
      act(() => result.current.resplitManualByDietType("low_carb"));

      // Nothing re-split — carbs/fat stay exactly as they were.
      expect(result.current.manualDraft.carbG).toBe(AUTO.carbG);
      expect(result.current.manualDraft.fatG).toBe(AUTO.fatG);
    });
  });

  it("hydrates from a stored manual override and starts in manual mode", () => {
    const { result } = renderHook(() =>
      useManualTargets({
        customMacrosEnabled: true,
        customCalories: 2100,
        customProteinG: 180,
        customCarbG: 200,
        customFatG: 62,
      })
    );

    expect(result.current.manualEnabled).toBe(true);
    expect(result.current.manualDraft).toEqual({
      calories: 2100,
      proteinG: 180,
      carbG: 200,
      fatG: 62,
    });
  });
});
