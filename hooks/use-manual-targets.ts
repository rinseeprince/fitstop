"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { applySurplusSplit, calculateDailyMacros } from "@/utils/nutrition-helpers";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import type { DietType } from "@/types/check-in";

/** A complete set of targets — what the calculator emits and what gets saved. */
export type MacroTargets = {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
};

/**
 * What the coach is typing. `null` means the field is EMPTY, which is a real,
 * distinct state from 0 — conflating the two is what made the fields
 * unwritable: clearing carbs read as "carbs = 0", which re-derived the calorie
 * field, and thereafter every keystroke in the calorie field produced an
 * intermediate value below the protein floor and snapped straight back.
 */
export type ManualDraft = {
  calories: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
};

type ManualField = keyof ManualDraft;

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

/** Macro calories, 4/4/9. */
export function macroCalories(t: { proteinG: number; carbG: number; fatG: number }): number {
  return Math.round(t.proteinG * 4 + t.carbG * 4 + t.fatG * 9);
}

/** Narrow a draft to a complete set, or null if anything is missing/zero. */
export function completeTargets(d: ManualDraft): MacroTargets | null {
  if (!d.calories || !d.proteinG || !d.carbG || !d.fatG) return null;
  return {
    calories: d.calories,
    proteinG: d.proteinG,
    carbG: d.carbG,
    fatG: d.fatG,
  };
}

/**
 * Manual override of the calorie/macro targets, in grams.
 *
 * **Typing never mutates another field.** The previous version re-derived the
 * calorie total on every macro keystroke and re-split the macros on every
 * calorie keystroke, which meant partially-entered state was continuously fed
 * back through the arithmetic — so a coach clearing one field found the others
 * rewritten, and could not then type a calorie target at all.
 *
 * Coherence is still required (the server rejects macros that disagree with the
 * stated calories by more than the tolerance), but it is now something the
 * coach is TOLD about and can fix with one click, not something enforced by
 * fighting their keyboard. The gate is at Generate, per owner direction.
 */
export function useManualTargets(seed: ManualSeed) {
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<ManualDraft>({
    calories: null,
    proteinG: null,
    carbG: null,
    fatG: null,
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
    setDraft({
      calories: seed.customCalories ?? null,
      proteinG: seed.customProteinG ?? null,
      carbG: seed.customCarbG ?? null,
      fatG: seed.customFatG ?? null,
    });
    setEnabled(true);
    seededRef.current = seedKey;
  }, [seedKey, seed]);

  /** Turn manual mode on, seeding from whatever auto currently shows. */
  const enable = useCallback((from: MacroTargets) => {
    setDraft({ ...from });
    setEnabled(true);
  }, []);

  const revertToAuto = useCallback(() => {
    setEnabled(false);
    seededRef.current = null;
  }, []);

  /** Sets ONLY the field being edited. No cross-field derivation. */
  const setField = useCallback((key: ManualField, value: number | null) => {
    setDraft((prev) => ({
      ...prev,
      [key]: value == null ? null : Math.max(0, Math.round(value)),
    }));
  }, []);

  /**
   * Explicitly rebalance carbs + fat so the macros match the entered calories,
   * holding protein AND the current carb:fat ratio. Offered as an action
   * rather than applied automatically — it is destructive to two fields, so
   * the coach asks for it.
   */
  const matchMacrosToCalories = useCallback(() => {
    setDraft((prev) => {
      if (!prev.calories || !prev.proteinG) return prev;
      // A degenerate 0:0 carb:fat ratio would make the split meaningless, so
      // fall back to an even carb:fat calorie split in that case.
      const { carbsG, fatG } = applySurplusSplit(
        prev.calories,
        prev.proteinG,
        prev.carbG || 1,
        prev.fatG || 1,
        false
      );
      return { ...prev, carbG: Math.max(0, carbsG), fatG: Math.max(0, fatG) };
    });
  }, []);

  /**
   * Recompose the macros from a PICKER change, holding the coach's CALORIE
   * target (the whole point of a manual override). The pickers above the boxes
   * have no editable box of their own — diet type is only a carb:fat split,
   * protein-per-kg is only a protein figure — so in manual mode they were
   * otherwise inert: a coach changing "Low Carb" or the protein target never
   * saw the boxes follow. `proteinG` (supplied on a protein-per-kg change)
   * replaces the protein box; otherwise the current protein is held. Carbs and
   * fat are always re-split by `dietType`.
   *
   * Fired ONLY on a deliberate picker change (a discrete action, never a
   * keystroke), so it does NOT reintroduce the per-keystroke derivation the
   * "typing never mutates another field" invariant above exists to prevent. A
   * no-op while calories or the resolved protein is mid-edit (null).
   */
  const recomposeMacros = useCallback(
    ({ proteinG, dietType }: { proteinG?: number; dietType: DietType }) => {
      setDraft((prev) => {
        const protein = proteinG ?? prev.proteinG;
        if (!prev.calories || !protein) return prev;
        const { carbsG, fatG } = calculateDailyMacros(prev.calories, protein, false, dietType);
        return {
          ...prev,
          proteinG: protein,
          carbG: Math.max(0, carbsG),
          fatG: Math.max(0, fatG),
        };
      });
    },
    []
  );

  const complete = completeTargets(draft);
  const macroTotal = complete ? macroCalories(complete) : null;
  const caloriesMismatch =
    complete !== null && macroTotal !== null
      ? Math.abs(complete.calories - macroTotal) > CUSTOM_MACRO_CALORIE_TOLERANCE
      : false;

  /**
   * Why this set of targets cannot be saved — evaluated continuously but
   * SURFACED only when the coach presses Generate (see the drawer footer).
   * Typing is never blocked.
   */
  const manualBlockingError = !enabled
    ? null
    : complete === null
      ? "Enter calories, protein, carbs and fat — all four are required"
      : caloriesMismatch
        ? `Macros total ${macroTotal!.toLocaleString()} kcal, which does not match the ${complete.calories.toLocaleString()} kcal target`
        : null;

  return {
    manualEnabled: enabled,
    manualDraft: draft,
    /** Complete + coherent targets, or null. What Generate posts. */
    manualTargets: caloriesMismatch ? null : complete,
    manualMacroTotal: macroTotal,
    manualCaloriesMismatch: caloriesMismatch,
    manualBlockingError,
    enableManualTargets: enable,
    revertToAuto,
    setManualField: setField,
    matchMacrosToCalories,
    recomposeManualMacros: recomposeMacros,
  };
}
