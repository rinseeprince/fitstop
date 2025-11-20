import type { UnitPreference, ActivityLevel, TrainingVolume } from "@/types/check-in";

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
