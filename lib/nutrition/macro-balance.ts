import { DIET_TYPE_SPLITS } from "@/utils/nutrition-helpers";
import type { DietType } from "@/types/check-in";

/**
 * The macro balancer's kernel — PURE, no React, no database.
 *
 * MyFitnessPal's goal setter is the reference (owner decision 2026-09-10):
 * ONE calorie target over a split of whole percents across carbs, fat and
 * protein; grams derive from the split at 4 / 4 / 9 kcal per gram; the
 * calories are held whatever the thumbs do. Both coach-facing manual entries
 * — the builder's "Edit manually" and the per-day editor's Set targets — run
 * on this, so the four numbers a coach saves cannot disagree.
 *
 * Every % is a whole number clamped 0–100 and every split sums to 100. The
 * slider's two thumbs are the two BOUNDARIES in MFP's order, carbs | fat |
 * protein: thumb A = carbs, thumb B = carbs + fat.
 */

export type Macro = "carbs" | "fat" | "protein";

/** Whole percents, summing to 100. */
export type MacroSplit = Record<Macro, number>;

/** Integer grams — the shape every save and every computed day carries. */
export type MacroGrams = { proteinG: number; carbG: number; fatG: number };

/**
 * A balancer's value — what both coach entries hold: the calorie target and
 * the split. `calories` is null while the field is empty, a real state
 * distinct from 0; the grams are derived, never stored beside these.
 */
export type MacroBalanceValue = { calories: number | null; split: MacroSplit };

const KCAL_PER_GRAM: Record<Macro, number> = { carbs: 4, fat: 9, protein: 4 };

/** The slider's left-to-right order. */
export const MACRO_ORDER: readonly Macro[] = ["carbs", "fat", "protein"];

/**
 * The split a balancer opens on when there are no grams to read — the
 * balanced preset at 30% protein. Both mounts normally seed from real grams.
 */
export const DEFAULT_SPLIT: MacroSplit = { carbs: 35, fat: 35, protein: 30 };

/**
 * A diet type as a re-split: a carb:fat ratio over the calories left after
 * protein — exactly what the diet type is to the calculator
 * (`calculateDailyMacros`). The balancer itself offers no presets — a manual
 * edit is the coach's hand alone (owner, 2026-09-10); `applyPreset` serves
 * the builder when a picker changes while manual mode is on. `custom` is no
 * ratio.
 */
type MacroPreset = Exclude<DietType, "custom">;

const clampPct = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));

/** 4P + 4C + 9F. */
export function gramsToCalories(grams: MacroGrams): number {
  return grams.proteinG * 4 + grams.carbG * 4 + grams.fatG * 9;
}

/**
 * Grams for a calorie target under a split. Protein and fat round to whole
 * grams; carbs take the REMAINDER, so the three sum to the target within one
 * carb rounding (2 kcal). The one exception is a split with no carbs to
 * absorb into: the remainder then has nowhere to go and the gap is the other
 * two roundings, under 7 kcal — still inside the server's 10 kcal belt
 * (`CUSTOM_MACRO_CALORIE_TOLERANCE`).
 */
export function splitToGrams(calories: number, split: MacroSplit): MacroGrams {
  const kcal = Math.max(0, Math.round(calories));
  const proteinG = Math.round((kcal * split.protein) / 100 / KCAL_PER_GRAM.protein);
  const fatG = Math.round((kcal * split.fat) / 100 / KCAL_PER_GRAM.fat);
  const carbG = Math.max(
    0,
    Math.round((kcal - proteinG * KCAL_PER_GRAM.protein - fatG * KCAL_PER_GRAM.fat) / KCAL_PER_GRAM.carbs)
  );
  return { proteinG, carbG, fatG };
}

/**
 * The split a set of grams is nearest to, in whole percents. Protein and fat
 * round; carbs take the remainder so the three sum to 100 — the same
 * direction `splitToGrams` absorbs in. Grams that carry no calories at all
 * seed the default split rather than a meaningless 0/0/0.
 *
 * Whole percents are the model's contract, so this snaps: a stored 150 / 250
 * / 80 g at 2,320 kcal reopens as 26 / 43 / 31 and derives back to 151 / 249
 * / 80. One percent of the target is the resolution of every thumb.
 */
export function gramsToSplit(grams: MacroGrams): MacroSplit {
  const total = gramsToCalories(grams);
  if (total <= 0) return DEFAULT_SPLIT;
  const protein = clampPct(((grams.proteinG * KCAL_PER_GRAM.protein) / total) * 100);
  const fat = clampPct(((grams.fatG * KCAL_PER_GRAM.fat) / total) * 100);
  return settle({ carbs: 100 - protein - fat, fat, protein });
}

/**
 * Move ONE macro to a gram figure and rebalance the other two in their
 * current ratio around the held calories. The typed grams snap to the nearest
 * whole percent of the target. With no calories to divide by there is nothing
 * to set, and the split stands.
 */
export function setGrams(split: MacroSplit, calories: number, macro: Macro, grams: number): MacroSplit {
  const kcal = Math.max(0, Math.round(calories));
  if (kcal <= 0) return split;
  const pct = clampPct(((Math.max(0, grams) * KCAL_PER_GRAM[macro]) / kcal) * 100);
  const [a, b] = MACRO_ORDER.filter((m) => m !== macro) as [Macro, Macro];
  const remaining = 100 - pct;
  const base = split[a] + split[b];
  // A 0:0 pair has no ratio to keep — split the remainder evenly.
  const aShare = base > 0 ? split[a] / base : 0.5;
  const aPct = Math.round(remaining * aShare);
  return { ...split, [macro]: pct, [a]: aPct, [b]: remaining - aPct };
}

/** Hold the protein share; re-split the rest by the diet type's ratio. */
export function applyPreset(split: MacroSplit, preset: MacroPreset): MacroSplit {
  const rest = 100 - split.protein;
  const carbs = Math.round(rest * DIET_TYPE_SPLITS[preset].carb);
  return { carbs, fat: rest - carbs, protein: split.protein };
}

/** The two thumbs: the boundaries carbs | fat and fat | protein. */
export function splitToThumbs(split: MacroSplit): [number, number] {
  return [split.carbs, split.carbs + split.fat];
}

/** Back from the thumbs; a crossed pair reads as a zero-width fat band. */
export function thumbsToSplit(thumbs: readonly number[]): MacroSplit {
  const carbs = clampPct(thumbs[0] ?? 0);
  const second = clampPct(Math.max(carbs, thumbs[1] ?? carbs));
  return { carbs, fat: second - carbs, protein: 100 - second };
}

/**
 * Make a split sum to exactly 100 after per-macro rounding. Protein and fat
 * each round at most half a point up, so the carbs remainder can dip to −1;
 * the overflow comes off fat.
 */
function settle(split: MacroSplit): MacroSplit {
  if (split.carbs >= 0) return split;
  return { carbs: 0, fat: split.fat + split.carbs, protein: split.protein };
}
