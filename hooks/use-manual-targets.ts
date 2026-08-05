"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { applySurplusSplit } from "@/utils/nutrition-helpers";

export type MacroTargets = {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
};

/** The plan fields that tell us a stored manual override exists. */
type ManualSeed =
  | {
      customMacrosEnabled?: boolean;
      customCalories?: number;
      customProteinG?: number;
      customCarbG?: number;
      customFatG?: number;
    }
  | null
  | undefined;

/** Macro calories, 4/4/9. The ONE definition — the submitted calorie total is
 *  always this, never a separately-typed number, so the server's ±50 kcal
 *  tolerance between stated calories and macro totals can never trip. */
export function macroCalories(t: Omit<MacroTargets, "calories">): number {
  return Math.round(t.proteinG * 4 + t.carbG * 4 + t.fatG * 9);
}

/**
 * Manual override of the calorie/macro targets, in GRAMS.
 *
 * Grams rather than the old percent split because the point of the merged tab
 * is that the fields are POPULATED by the auto calculation and then edited —
 * and the calculator emits grams. A percent model would have made "override
 * what you see" mean retyping it in a different unit.
 *
 * The four fields are kept arithmetically coherent at all times:
 *   - editing a macro re-totals the calories (4/4/9)
 *   - editing the calories re-splits carbs + fat and HOLDS protein
 * Protein is the macro a coach deliberately pins (it is prescribed per kg of
 * bodyweight), so a calorie edit must never silently move it. The carb:fat
 * ratio is preserved through applySurplusSplit — the same helper the surplus
 * path uses, so "keep my split" means the same thing everywhere.
 */
export function useManualTargets(seed: ManualSeed) {
  const [enabled, setEnabled] = useState(false);
  const [targets, setTargets] = useState<MacroTargets>({
    calories: 0,
    proteinG: 0,
    carbG: 0,
    fatG: 0,
  });

  // Opening the drawer on a plan that already carries a manual override starts
  // in manual mode showing those numbers. Seeded once per distinct plan so a
  // background refetch cannot clobber an in-progress edit.
  const seedKey =
    seed?.customMacrosEnabled && seed.customCalories
      ? `${seed.customCalories}|${seed.customProteinG}|${seed.customCarbG}|${seed.customFatG}`
      : null;
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seedKey || !seed || seededRef.current === seedKey) return;
    setTargets({
      calories: seed.customCalories ?? 0,
      proteinG: seed.customProteinG ?? 0,
      carbG: seed.customCarbG ?? 0,
      fatG: seed.customFatG ?? 0,
    });
    setEnabled(true);
    seededRef.current = seedKey;
  }, [seedKey, seed]);

  /** Turn manual mode on, seeding from whatever the auto calculation currently
   *  shows. Seeding from the LIVE auto result is the point: the previous hook
   *  only hydrated from a stored custom plan, so switching to manual on an auto
   *  plan presented a row of zeros instead of the numbers on screen. */
  const enable = useCallback((from: MacroTargets) => {
    setTargets(from);
    setEnabled(true);
  }, []);

  /** Discard the overrides and fall back to the live auto calculation. */
  const revertToAuto = useCallback(() => {
    setEnabled(false);
    seededRef.current = null;
  }, []);

  const setMacro = useCallback((key: "proteinG" | "carbG" | "fatG", value: number) => {
    setTargets((prev) => {
      const next = { ...prev, [key]: Math.max(0, Math.round(value)) };
      return { ...next, calories: macroCalories(next) };
    });
  }, []);

  const setCalories = useCallback((value: number) => {
    setTargets((prev) => {
      const calories = Math.max(0, Math.round(value));
      const { carbsG, fatG } = applySurplusSplit(
        calories,
        prev.proteinG,
        prev.carbG,
        prev.fatG,
        false // keep the existing carb:fat ratio; never re-derive from diet type
      );
      const next = { ...prev, carbG: Math.max(0, carbsG), fatG: Math.max(0, fatG) };
      // Re-total rather than trusting the typed number: the gram values are
      // rounded, so 4/4/9 over them is the figure that will actually be stored.
      return { ...next, calories: macroCalories(next) };
    });
  }, []);

  const validationError =
    targets.calories <= 0
      ? "Enter a calorie target greater than 0"
      : targets.proteinG <= 0 || targets.carbG <= 0 || targets.fatG <= 0
        ? "Protein, carbs and fat must each be greater than 0"
        : null;

  return {
    manualEnabled: enabled,
    manualTargets: targets,
    manualValidationError: validationError,
    enableManualTargets: enable,
    revertToAuto,
    setManualMacro: setMacro,
    setManualCalories: setCalories,
  };
}
