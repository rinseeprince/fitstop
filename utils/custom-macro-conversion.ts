/**
 * Custom-macros %↔grams conversion (Session 4 ◆3). The coach enters a total
 * calorie target + a P/C/F percent split; macros are STORED as grams (the
 * generate payload is unchanged). Fat% auto-fills to 100 − P% − C%.
 */

export type MacroGrams = { protein: number; carbs: number; fat: number };

/**
 * Derive grams from a calorie total + P/C/F percent split. `fatPct` defaults to
 * the remainder (100 − P − C); pass it explicitly when fat is edited directly.
 */
export function percentToGrams(
  calories: number,
  proteinPct: number,
  carbPct: number,
  fatPct: number = Math.max(0, 100 - proteinPct - carbPct)
): MacroGrams {
  return {
    protein: Math.round((calories * proteinPct) / 100 / 4),
    carbs: Math.round((calories * carbPct) / 100 / 4),
    fat: Math.round((calories * fatPct) / 100 / 9),
  };
}

/** Re-totaled actual calories implied by the rounded grams (4/4/9). */
export function macroCalories(g: MacroGrams): number {
  return g.protein * 4 + g.carbs * 4 + g.fat * 9;
}

/**
 * Derive a percent split from stored grams (used when opening an existing custom
 * plan). Fat% absorbs rounding so the three always sum to 100.
 */
export function gramsToPercent(
  g: MacroGrams,
  calories: number
): { proteinPct: number; carbPct: number; fatPct: number } {
  const total = calories > 0 ? calories : macroCalories(g);
  if (total <= 0) return { proteinPct: 0, carbPct: 0, fatPct: 0 };
  const proteinPct = Math.round(((g.protein * 4) / total) * 100);
  const carbPct = Math.round(((g.carbs * 4) / total) * 100);
  return { proteinPct, carbPct, fatPct: Math.max(0, 100 - proteinPct - carbPct) };
}
