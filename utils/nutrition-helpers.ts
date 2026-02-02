import type { UnitPreference, ActivityLevel, TrainingVolume, DietType } from "@/types/check-in";
import type { TrainingPlan, TrainingSession } from "@/types/training";
import type { ActivityMetadata } from "@/types/external-activity";
import { getTrainingCaloriesByDay, getTrainingSessionCaloriesByDay, getTrainingSessionsSummary } from "@/utils/training-calorie-helpers";

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
  // External activity data (BJJ, cycling, etc.)
  externalActivityCalories: number;
  externalActivities: Array<{ name: string; calories: number }>;
  totalCaloriesWithActivities: number;
};

/**
 * Get external activities for a specific day from a training plan
 */
export function getExternalActivitiesForDay(
  plan: TrainingPlan | null,
  day: DayOfWeek
): TrainingSession[] {
  if (!plan) return [];

  return plan.sessions.filter(
    (session) =>
      session.sessionType === "external_activity" &&
      session.dayOfWeek?.toLowerCase() === day
  );
}

/**
 * Calculate total external activity calories for a day
 */
export function calculateExternalActivityCalories(
  activities: TrainingSession[]
): number {
  return activities.reduce(
    (sum, activity) => sum + (activity.activityMetadata?.estimatedCalories || 0),
    0
  );
}

/**
 * Get external activities summary for a day
 */
export function getExternalActivitiesSummary(
  activities: TrainingSession[]
): Array<{ name: string; calories: number }> {
  return activities.map((activity) => ({
    name: activity.name,
    calories: activity.activityMetadata?.estimatedCalories || 0,
  }));
}

/**
 * Get training days from a training plan (excluding external activities)
 * Returns a Set of lowercase day names
 */
export function getTrainingDays(plan: TrainingPlan | null): Set<string> {
  if (!plan) return new Set();

  const days = new Set<string>();
  plan.sessions.forEach((session) => {
    // Only count actual training sessions, not external activities
    if (session.dayOfWeek && session.sessionType !== "external_activity") {
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
 * @deprecated This function used a 25% multiplier approach.
 * Use getWeeklyNutritionTargets with baselineCalories instead,
 * which adds actual training session calories per day.
 */
export function calculateCalorieDistribution(
  dailyCalorieTarget: number,
  trainingDaysCount: number
): { trainingDayCalories: number; restDayCalories: number } {
  // Now just returns the same calories for both - actual training calories
  // are added per-day in getWeeklyNutritionTargets
  return {
    trainingDayCalories: dailyCalorieTarget,
    restDayCalories: dailyCalorieTarget,
  };
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
  isTrainingDay: boolean,
  dietType: DietType = "balanced"
): { proteinG: number; carbsG: number; fatG: number } {
  const proteinCal = proteinG * 4;
  const remainingCal = dayCalories - proteinCal;

  // Get base split from diet type
  const baseSplit = getDietTypeSplit(dietType);

  // Apply training day adjustment:
  // - Training days: shift 10% more toward carbs (capped by diet type)
  // - Rest days: shift 10% more toward fat (capped by diet type)
  // - Keto stays very low carb regardless
  let carbRatio: number;

  if (dietType === "keto") {
    // Keto: minimal adjustment to preserve ketosis
    carbRatio = isTrainingDay ? 0.12 : 0.08;
  } else if (dietType === "low_carb") {
    // Low carb: small adjustment
    carbRatio = isTrainingDay ? 0.30 : 0.20;
  } else if (dietType === "high_carb") {
    // High carb: already high, small boost on training
    carbRatio = isTrainingDay ? 0.70 : 0.60;
  } else {
    // Balanced/custom: moderate swing
    carbRatio = isTrainingDay ? 0.55 : 0.45;
  }

  const carbCal = remainingCal * carbRatio;
  const fatCal = remainingCal * (1 - carbRatio);

  return {
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbCal / 4),
    fatG: Math.round(fatCal / 9),
  };
}

/**
 * Get complete daily nutrition targets for all 7 days
 * Uses baseline calories (TDEE - deficit) and adds actual training calories per day.
 *
 * @param baselineCalories - Rest day calories (TDEE minus required deficit)
 * @param proteinTargetG - Daily protein target in grams
 * @param trainingPlan - Training plan with session data for per-day calories
 * @param dietType - Diet type for macro split
 */
export function getWeeklyNutritionTargets(
  baselineCalories: number,
  proteinTargetG: number,
  trainingPlan: TrainingPlan | null,
  dietType: DietType = "balanced"
): DailyNutritionTargets[] {
  // Get training session calories (from generated training plan)
  const trainingSessionCaloriesByDay = getTrainingSessionCaloriesByDay(trainingPlan);
  const trainingDays = getTrainingDays(trainingPlan);

  return DAYS_OF_WEEK.map((day) => {
    const isTrainingDay = trainingDays.has(day);

    // Get training session calories for this day (from generated plan)
    const trainingSessionCalories = trainingSessionCaloriesByDay[day] || 0;
    const trainingSessions = getTrainingSessionsSummary(trainingPlan, day);

    // Get external activities breakdown for this day
    const dayActivities = getExternalActivitiesForDay(trainingPlan, day);
    const externalActivityCalories = calculateExternalActivityCalories(dayActivities);
    const externalActivities = getExternalActivitiesSummary(dayActivities);

    // Total calories = baseline + training sessions + external activities
    const totalActivityCalories = trainingSessionCalories + externalActivityCalories;
    const dayCalories = baselineCalories + totalActivityCalories;

    // Calculate macros based on total day calories
    // Protein stays constant, extra calories go to carbs/fats
    const macros = calculateDailyMacros(dayCalories, proteinTargetG, isTrainingDay, dietType);

    // Calculate percentages based on total day calories
    const totalCal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
    const proteinPercent = totalCal > 0 ? Math.round((macros.proteinG * 4 / totalCal) * 100) : 0;
    const carbsPercent = totalCal > 0 ? Math.round((macros.carbsG * 4 / totalCal) * 100) : 0;
    const fatPercent = 100 - proteinPercent - carbsPercent;

    return {
      day,
      dayLabel: day.charAt(0).toUpperCase() + day.slice(1),
      isTrainingDay,
      calories: dayCalories,
      baselineCalories,
      proteinG: macros.proteinG,
      carbsG: macros.carbsG,
      fatG: macros.fatG,
      proteinPercent,
      carbsPercent,
      fatPercent,
      trainingSessionCalories,
      trainingSessions,
      externalActivityCalories,
      externalActivities,
      totalCaloriesWithActivities: dayCalories,
    };
  });
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
