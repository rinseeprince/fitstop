import type { ActivityLevel, DietType } from "@/types/check-in";

/**
 * Days of the week constant
 */
export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/**
 * Daily nutrition targets for a specific day
 */
export type DailyNutritionTargets = {
  planId?: string;
  /**
   * The calendar date this day falls on, YYYY-MM-DD. The payload's statement of
   * WHEN — without it a renderer can only guess an order from the weekday name,
   * and a client whose week runs Saturday-to-Friday gets shown a Monday-first
   * week with its two earliest days last. Absent on the coach-side template
   * projections, which describe a weekday rather than a date.
   */
  date?: string;
  day: DayOfWeek;
  dayLabel: string;
  isTrainingDay: boolean;
  calories: number; // Total calories for the day (baseline + all activities)
  baselineCalories: number; // Base calories before any training/activity additions
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
  // Training session data (from generated training plan)
  trainingSessionCalories: number;
  trainingSessions: Array<{ name: string; calories: number }>;
  totalCaloriesWithActivities: number;
  includeActivityBurn: boolean;
  calorieSurplusPercentage?: number | null;
  // Optional coach per-day note (rides a materialized event edit). Surfaced to
  // the client on the program card + day-view. Null/undefined on template days.
  note?: string | null;
};

/**
 * Get base carb/fat split ratios for a diet type
 */
function getDietTypeSplit(dietType: DietType): { carb: number; fat: number } {
  const dietSplits: Record<DietType, { carb: number; fat: number }> = {
    balanced: { carb: 0.5, fat: 0.5 },
    high_carb: { carb: 0.65, fat: 0.35 },
    low_carb: { carb: 0.25, fat: 0.75 },
    keto: { carb: 0.1, fat: 0.9 },
    custom: { carb: 0.5, fat: 0.5 },
  };
  return dietSplits[dietType] || dietSplits.balanced;
}

/**
 * Calculate macros for a specific day based on whether it's a training day
 * - Protein stays constant (recovery requirement)
 * - Carb/fat split is based on diet type, with training day adjustments
 * - Training days shift slightly toward more carbs (within diet constraints)
 */
export function calculateDailyMacros(
  dayCalories: number,
  proteinG: number,
  _isTrainingDay: boolean,
  dietType: DietType = "balanced"
): { proteinG: number; carbsG: number; fatG: number } {
  const proteinCal = proteinG * 4;
  const remainingCal = dayCalories - proteinCal;

  // Always use the base diet type ratios — extra training calories already
  // increase absolute macro grams proportionally without shifting the split.
  const baseSplit = getDietTypeSplit(dietType);
  const carbRatio = baseSplit.carb;

  const carbCal = remainingCal * carbRatio;
  const fatCal = remainingCal * (1 - carbRatio);

  return {
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbCal / 4),
    fatG: Math.round(fatCal / 9),
  };
}

/**
 * Split a training-day calorie total into carbs + fat, holding protein.
 * The single source of truth for the surplus-split policy, shared by the
 * event display path (`mapNutritionEventToDisplayTarget`) and the plan-template
 * path (`buildDailyTargetsFromPlan`) so the client program card matches the
 * coach calendar.
 *   - surplusAsCarbs=false ("keep my split"): carbs + fat scale to the higher
 *     total PRESERVING their stored ratio (the coach's split is honored, never
 *     re-derived from the diet type — keto stays keto).
 *   - surplusAsCarbs=true ("carbs only"): fat is ALSO held; the whole surplus
 *     is added as carbs.
 * Caller owns the verbatim guard (no surplus / frozen day / burn off) — this
 * helper assumes a real surplus applies.
 */
export function applySurplusSplit(
  totalCalories: number,
  proteinG: number,
  baselineCarbG: number,
  baselineFatG: number,
  surplusAsCarbs: boolean
): { carbsG: number; fatG: number } {
  if (surplusAsCarbs) {
    // Fat held too; carbs absorb the entire surplus.
    const fatG = baselineFatG;
    const carbsG = Math.round((totalCalories - proteinG * 4 - fatG * 9) / 4);
    return { carbsG, fatG };
  }
  // Carbs + fat scale to the higher total preserving their stored ratio.
  const carbFatCalories = Math.max(0, totalCalories - proteinG * 4);
  const baseCarbCal = baselineCarbG * 4;
  const baseFatCal = baselineFatG * 9;
  const baseCarbFat = baseCarbCal + baseFatCal;
  const carbShare = baseCarbFat > 0 ? baseCarbCal / baseCarbFat : 0.5;
  const carbsG = Math.round((carbFatCalories * carbShare) / 4);
  const fatG = Math.round((carbFatCalories * (1 - carbShare)) / 9);
  return { carbsG, fatG };
}

// The unit-conversion helpers that used to live here are gone: lbsToKg,
// inchesToCm, cmToInches, weightToKg and weightFromKg were all dead once storage
// became canonical (migration 141), and their 2.205 was one of the four
// conflicting lbs<->kg constants utils/unit-conversions.ts exists to replace.
//
// Nothing in this file knows about pounds any more. formatWeight, kgToLbs and
// getWeightChange went with their last callers — the two nutrition banners,
// which now use utils/unit-conversions.ts against the VIEWER's preference
// rather than the client's.

/**
 * Protein target multipliers, in grams per KILOGRAM of body weight.
 *
 * The gPerLb mirror is gone: it was hand-rounded off the old 2.205 constant
 * (1.6 -> 0.73), so it could drift from its gPerKg sibling with nothing to
 * catch it. The render layer derives per-pound with KG_PER_LB when the viewer
 * is imperial.
 */
export const PROTEIN_TARGETS = {
  minimum: { gPerKg: 1.6 },
  moderate: { gPerKg: 1.8 },
  high: { gPerKg: 2.0 },
  veryHigh: { gPerKg: 2.2 },
} as const;

/**
 * Get activity level multiplier for TDEE calculation
 */
export function getActivityMultiplier(activityLevel: ActivityLevel): number {
  const multipliers: Record<ActivityLevel, number> = {
    sedentary: 1.2,
    lightly_active: 1.375,
    moderately_active: 1.55,
    very_active: 1.725,
    extremely_active: 1.9,
  };
  return multipliers[activityLevel];
}

/**
 * Calculate weight change needed to trigger regeneration banner
 * Returns true if weight has changed by 3kg or more
 */
export function shouldShowRegenerationBanner(
  currentWeightKg: number,
  baseWeightKg: number
): boolean {
  const THRESHOLD_KG = 3;
  return Math.abs(currentWeightKg - baseWeightKg) >= THRESHOLD_KG;
}

