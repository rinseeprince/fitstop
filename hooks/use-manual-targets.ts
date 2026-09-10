"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  DEFAULT_SPLIT,
  applyPreset,
  gramsToSplit,
  setGrams,
  splitToGrams,
  type MacroBalanceValue,
} from "@/lib/nutrition/macro-balance";
import type { DietType } from "@/types/check-in";

/** A complete set of targets — what the calculator emits and what gets saved. */
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

/**
 * Manual override of the calorie/macro targets — the macro balancer's state
 * (owner decision 2026-09-10: MyFitnessPal's goal setter is the reference):
 * a calorie target and a whole-percent split, the grams DERIVED from them at
 * 4 / 4 / 9 kcal per gram, so the four numbers cannot disagree.
 *
 * The calories are held whatever the thumbs do, so there is nothing to reconcile and no gate but "is there a calorie
 * target": the coherence the old four typed fields had to be TOLD about is
 * true by construction. The server keeps a tolerance belt of its own for raw
 * API callers.
 */
export function useManualTargets(seed: ManualSeed) {
  const [enabled, setEnabled] = useState(false);
  const [balance, setBalance] = useState<MacroBalanceValue>({
    calories: null,
    split: DEFAULT_SPLIT,
  });

  // Opening the drawer on a plan that already carries a manual override starts
  // in manual mode on its numbers — the calories exactly, the split read off
  // the stored grams in whole percents. Seeded once per distinct plan so a
  // background refetch cannot clobber an in-progress edit.
  const seedKey =
    seed?.customMacrosEnabled && seed.customCalories
      ? `${seed.customCalories}|${seed.customProteinG}|${seed.customCarbG}|${seed.customFatG}`
      : null;
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seedKey || !seed || seededRef.current === seedKey) return;
    setBalance({
      calories: seed.customCalories ?? null,
      split: gramsToSplit({
        proteinG: seed.customProteinG ?? 0,
        carbG: seed.customCarbG ?? 0,
        fatG: seed.customFatG ?? 0,
      }),
    });
    setEnabled(true);
    seededRef.current = seedKey;
  }, [seedKey, seed]);

  /** Turn manual mode on, seeding from whatever auto currently shows. */
  const enable = useCallback((from: MacroTargets) => {
    setBalance({ calories: from.calories, split: gramsToSplit(from) });
    setEnabled(true);
  }, []);

  const revertToAuto = useCallback(() => {
    setEnabled(false);
    seededRef.current = null;
  }, []);

  /**
   * Recompose the split from a PICKER change, holding the coach's CALORIE
   * target (the whole point of a manual override). The pickers above the
   * balancer have no control of their own on it — diet type is only a
   * carb:fat ratio, protein-per-kg is only a protein figure — so in manual
   * mode they were otherwise inert. `proteinG` (supplied on a protein-per-kg
   * change) moves the protein share; the diet type then re-splits the rest.
   *
   * Fired ONLY on a deliberate picker change (a discrete action, never a
   * keystroke). A no-op while the calorie field is empty.
   */
  const recomposeMacros = useCallback(
    ({ proteinG, dietType }: { proteinG?: number; dietType: DietType }) => {
      setBalance((prev) => {
        if (!prev.calories) return prev;
        let split =
          proteinG != null ? setGrams(prev.split, prev.calories, "protein", proteinG) : prev.split;
        // "custom" is no ratio — the coach's own split stands.
        if (dietType !== "custom") split = applyPreset(split, dietType);
        return { ...prev, split };
      });
    },
    []
  );

  /** Complete targets, or null while there is no calorie target. What Generate posts. */
  const manualTargets: MacroTargets | null =
    balance.calories != null && balance.calories > 0
      ? { calories: balance.calories, ...splitToGrams(balance.calories, balance.split) }
      : null;

  /**
   * Why this set of targets cannot be saved — SURFACED only when the coach
   * presses Generate (see the drawer footer). Typing is never blocked.
   */
  const manualBlockingError = !enabled ? null : manualTargets ? null : "Enter a calorie target";

  return {
    manualEnabled: enabled,
    manualBalance: balance,
    manualTargets,
    manualBlockingError,
    enableManualTargets: enable,
    revertToAuto,
    setManualBalance: setBalance,
    recomposeManualMacros: recomposeMacros,
  };
}
