"use client";

import { useState, useEffect, useRef } from "react";
import {
  percentToGrams,
  macroCalories,
  gramsToPercent,
} from "@/utils/custom-macro-conversion";

/** The plan fields used to seed the % split when opening an existing custom plan. */
type CustomMacroSeed =
  | {
      customMacrosEnabled?: boolean;
      calorieTarget?: number;
      proteinTargetG?: number;
      carbTargetG?: number;
      fatTargetG?: number;
    }
  | null
  | undefined;

/**
 * Custom-macros input state (Session 4 ◆3). The coach edits a total calorie
 * target + a P/C/F percent split — ALL THREE are independently editable, with a
 * guard that they must total 100%. Macros are STORED as grams so the generate
 * payload is unchanged, and `customMacros.calories` is the RE-TOTALED macro
 * calories (4/4/9) so the server's +-50 tolerance can't trip on rounding. Opening
 * an existing custom plan seeds the split from its stored grams.
 */
export function useCustomMacros(seed: CustomMacroSeed) {
  const [calories, setCalories] = useState(0);
  const [proteinPct, setProteinPct] = useState(30);
  const [carbPct, setCarbPct] = useState(40);
  const [fatPct, setFatPct] = useState(30);

  // Seed % + calories from an existing custom plan when it loads (once per plan).
  const seedKey =
    seed?.customMacrosEnabled && seed.calorieTarget
      ? `${seed.calorieTarget}|${seed.proteinTargetG}|${seed.carbTargetG}|${seed.fatTargetG}`
      : null;
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seedKey || !seed || seededRef.current === seedKey) return;
    const cals = seed.calorieTarget ?? 0;
    const pct = gramsToPercent(
      {
        protein: seed.proteinTargetG ?? 0,
        carbs: seed.carbTargetG ?? 0,
        fat: seed.fatTargetG ?? 0,
      },
      cals
    );
    setCalories(cals);
    setProteinPct(pct.proteinPct);
    setCarbPct(pct.carbPct);
    setFatPct(pct.fatPct);
    seededRef.current = seedKey;
  }, [seedKey, seed]);

  const grams = percentToGrams(calories, proteinPct, carbPct, fatPct);
  const reTotaledCalories = macroCalories(grams);

  // The generate payload: grams + the re-totaled calories (NOT the entered total).
  const customMacros = {
    protein: grams.protein,
    carbs: grams.carbs,
    fat: grams.fat,
    calories: reTotaledCalories,
  };

  const pctSum = proteinPct + carbPct + fatPct;
  const customMacrosValidationError =
    calories <= 0
      ? "Enter a calorie total greater than 0"
      : pctSum !== 100
        ? `Macro percentages must total 100% (currently ${pctSum}%)`
        : null;

  return {
    customCalories: calories,
    setCustomCalories: setCalories,
    customProteinPct: proteinPct,
    setCustomProteinPct: setProteinPct,
    customCarbPct: carbPct,
    setCustomCarbPct: setCarbPct,
    customFatPct: fatPct,
    setCustomFatPct: setFatPct,
    customGrams: grams,
    customReTotaledCalories: reTotaledCalories,
    customMacros,
    customMacrosValidationError,
  };
}
