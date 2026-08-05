import type { UnitPreference, ActivityLevel, TrainingVolume, DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";

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
 * Get training days from a training plan (excluding external activities)
 * Returns a Set of lowercase day names
 */
export function getTrainingDays(plan: TrainingPlan | null): Set<string> {
  if (!plan) return new Set();

  const days = new Set<string>();
  plan.sessions.forEach((session) => {
    if (session.dayOfWeek) {
      days.add(session.dayOfWeek.toLowerCase());
    }
  });

  // If no days assigned, distribute based on frequency
  if (days.size === 0 && plan.frequencyPerWeek) {
    // Default distribution: spread evenly through week
    const defaultDistribution: Record<number, DayOfWeek[]> = {
      1: ["monday"],
      2: ["monday", "thursday"],
      3: ["monday", "wednesday", "friday"],
      4: ["monday", "tuesday", "thursday", "friday"],
      5: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      6: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      7: DAYS_OF_WEEK as unknown as DayOfWeek[],
    };
    const defaultDays = defaultDistribution[plan.frequencyPerWeek] || [];
    defaultDays.forEach((day) => days.add(day));
  }

  return days;
}

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
 * path (`buildDailyTargetsFromPlan`) so the client program card + the coach
 * Plans-tab totals match the coach calendar.
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

/**
 * Calculate suggested training volume based on training plan
 */
export function getSuggestedTrainingVolume(
  trainingPlan: TrainingPlan | null
): TrainingVolume | null {
  if (!trainingPlan) return null;

  // Calculate total weekly training hours from session durations
  const totalMinutes = trainingPlan.sessions.reduce(
    (sum, session) => sum + (session.estimatedDurationMinutes || 60),
    0
  );
  const totalHours = totalMinutes / 60;

  // Map to TrainingVolume categories
  if (totalHours <= 1) return "0-1";
  if (totalHours <= 3) return "2-3";
  if (totalHours <= 5) return "4-5";
  if (totalHours <= 7) return "6-7";
  return "8+";
}

/**
 * Unit conversion utilities
 */

export function lbsToKg(lbs: number): number {
  return lbs / 2.205;
}

export function kgToLbs(kg: number): number {
  return kg * 2.205;
}

export function inchesToCm(inches: number): number {
  return inches * 2.54;
}

export function cmToInches(cm: number): number {
  return cm / 2.54;
}

/**
 * Convert weight to kg for internal calculations
 */
export function weightToKg(weight: number, unit: "lbs" | "kg"): number {
  return unit === "lbs" ? lbsToKg(weight) : weight;
}

/**
 * Convert weight from kg to display unit
 */
export function weightFromKg(weightKg: number, unit: "lbs" | "kg"): number {
  return unit === "lbs" ? kgToLbs(weightKg) : weightKg;
}

/**
 * Format weight with appropriate unit
 */
export function formatWeight(
  weight: number,
  unitPreference: UnitPreference
): string {
  const unit = unitPreference === "imperial" ? "lbs" : "kg";
  const displayWeight =
    unitPreference === "imperial" ? kgToLbs(weight) : weight;
  return `${displayWeight.toFixed(1)} ${unit}`;
}

/**
 * Protein target multiplier conversions
 * These are equivalent values in different units
 */
export const PROTEIN_TARGETS = {
  minimum: { gPerKg: 1.6, gPerLb: 0.73 },
  moderate: { gPerKg: 1.8, gPerLb: 0.82 },
  high: { gPerKg: 2.0, gPerLb: 0.91 },
  veryHigh: { gPerKg: 2.2, gPerLb: 1.0 },
} as const;

/**
 * Get protein target label based on g/kg value and unit preference
 */
export function getProteinTargetLabel(
  gPerKg: number,
  unitPreference: UnitPreference
): string {
  if (unitPreference === "metric") {
    return `${gPerKg.toFixed(1)}g per kg`;
  }

  // Convert to g/lb for imperial
  const gPerLb = gPerKg / 2.205;
  return `${gPerLb.toFixed(2)}g per lb`;
}

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
 * Get training volume calories to add to TDEE
 */
export function getTrainingCalories(trainingVolume: TrainingVolume): number {
  const calories: Record<TrainingVolume, number> = {
    "0-1": 0,
    "2-3": 250,
    "4-5": 400,
    "6-7": 550,
    "8+": 700,
  };
  return calories[trainingVolume];
}

/**
 * Get activity level display name
 */
export function getActivityLevelLabel(activityLevel: ActivityLevel): string {
  const labels: Record<ActivityLevel, string> = {
    sedentary: "Sedentary (desk job)",
    lightly_active: "Lightly Active (light movement)",
    moderately_active: "Moderately Active (on feet most of day)",
    very_active: "Very Active (physical job)",
    extremely_active: "Extremely Active (athlete/heavy labor)",
  };
  return labels[activityLevel];
}

/**
 * Get training volume display label
 */
export function getTrainingVolumeLabel(trainingVolume: TrainingVolume): string {
  return `${trainingVolume} hours/week`;
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

/**
 * Get weight change in display unit
 */
export function getWeightChange(
  currentWeightKg: number,
  baseWeightKg: number,
  unitPreference: UnitPreference
): { value: number; unit: string; isLoss: boolean } {
  const changeKg = currentWeightKg - baseWeightKg;
  const unit = unitPreference === "imperial" ? "lbs" : "kg";
  const value =
    unitPreference === "imperial" ? kgToLbs(Math.abs(changeKg)) : Math.abs(changeKg);

  return {
    value: parseFloat(value.toFixed(1)),
    unit,
    isLoss: changeKg < 0,
  };
}
