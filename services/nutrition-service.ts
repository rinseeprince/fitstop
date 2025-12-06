import type {
  ActivityLevel,
  TrainingVolume,
  DietType,
} from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import {
  getActivityMultiplier,
  getTrainingCalories,
} from "@/utils/nutrition-helpers";

export type NutritionPlan = {
  baselineCalories: number; // Rest day calories (TDEE - deficit)
  tdee: number; // Pure TDEE (BMR x activity multiplier, no training)
  calorieTarget: number; // For backward compatibility (same as baselineCalories)
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  adjustedTdee: number; // Keep for backward compat (same as tdee now)
  weeklyWeightChangeKg: number;
  requiredDailyDeficit: number; // The deficit needed per day to hit goal
  warnings: string[];
};

export type NutritionCalculationInput = {
  currentWeightKg: number;
  goalWeightKg?: number;
  bmr: number;
  gender: "male" | "female" | "other";
  workActivityLevel: ActivityLevel;
  trainingVolumeHours?: TrainingVolume; // Deprecated: kept for backward compat
  trainingPlan?: TrainingPlan | null; // Used for per-day calorie additions
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalDeadline?: string;
  weightUnit: "lbs" | "kg";
};

/**
 * Calculate pure TDEE based on activity level only (no training calories)
 * Training calories are added per-day in the weekly nutrition targets
 */
export function calculateTDEE(
  bmr: number,
  workActivityLevel: ActivityLevel
): number {
  const activityMultiplier = getActivityMultiplier(workActivityLevel);
  return Math.round(bmr * activityMultiplier);
}

/**
 * Calculate baseline calories (rest day calories)
 * This is TDEE minus the required daily deficit to achieve goal by deadline
 */
export function calculateBaselineCalories(
  tdee: number,
  currentWeightKg: number,
  goalWeightKg: number | undefined,
  goalDeadline: string | undefined,
  gender: "male" | "female" | "other"
): {
  baselineCalories: number;
  requiredDailyDeficit: number;
  weeklyRate: number;
  warnings: string[];
} {
  const warnings: string[] = [];

  // If no goal weight or deadline, use maintenance calories (no deficit)
  if (!goalWeightKg || !goalDeadline) {
    return {
      baselineCalories: tdee,
      requiredDailyDeficit: 0,
      weeklyRate: 0,
      warnings: [],
    };
  }

  // Calculate time to goal
  const today = new Date();
  const deadline = new Date(goalDeadline);
  const daysToGoal = Math.ceil(
    (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysToGoal <= 0) {
    warnings.push("Goal deadline has passed. Using maintenance calories.");
    return {
      baselineCalories: tdee,
      requiredDailyDeficit: 0,
      weeklyRate: 0,
      warnings,
    };
  }

  // Calculate total weight change needed
  const weightChangeKg = goalWeightKg - currentWeightKg;
  const isWeightLoss = weightChangeKg < 0;

  // Calculate total calorie deficit/surplus needed (1kg = 7700 calories)
  const totalCalorieChange = Math.abs(weightChangeKg) * 7700;

  // Calculate required daily deficit/surplus
  let requiredDailyChange = totalCalorieChange / daysToGoal;

  // Calculate weekly rate for display
  const weeksToGoal = daysToGoal / 7;
  let weeklyRate = weightChangeKg / weeksToGoal;

  // Gender-specific safety caps
  const maxWeeklyDeficitKg = gender === "female" ? 0.75 : 1.0;
  const maxWeeklySurplusKg = gender === "female" ? 0.35 : 0.5;

  // Cap the rate if too aggressive
  if (isWeightLoss && weeklyRate < -maxWeeklyDeficitKg) {
    weeklyRate = -maxWeeklyDeficitKg;
    requiredDailyChange = (maxWeeklyDeficitKg * 7700) / 7;
    warnings.push(
      `Weekly deficit capped at ${maxWeeklyDeficitKg}kg/week for safety. Goal timeline may need adjustment.`
    );
  } else if (!isWeightLoss && weeklyRate > maxWeeklySurplusKg) {
    weeklyRate = maxWeeklySurplusKg;
    requiredDailyChange = (maxWeeklySurplusKg * 7700) / 7;
    warnings.push(
      `Weekly surplus capped at ${maxWeeklySurplusKg}kg/week for optimal muscle gain. Goal timeline may need adjustment.`
    );
  }

  // Calculate baseline calories
  // For weight loss: baseline = TDEE - deficit
  // For weight gain: baseline = TDEE + surplus
  const requiredDailyDeficit = isWeightLoss ? requiredDailyChange : -requiredDailyChange;
  let baselineCalories = Math.round(tdee - requiredDailyDeficit);

  // Ensure minimum calories
  const minimumCalories = gender === "female" ? 1200 : 1500;
  if (baselineCalories < minimumCalories) {
    warnings.push(
      `Calorie target raised to minimum safe level (${minimumCalories} cal/day). Consider adjusting goal timeline.`
    );
    baselineCalories = minimumCalories;
  }

  return {
    baselineCalories,
    requiredDailyDeficit,
    weeklyRate,
    warnings,
  };
}

/**
 * @deprecated Use calculateTDEE instead. Kept for backward compatibility.
 * This now returns pure TDEE without training calories.
 */
export function calculateAdjustedTDEE(
  bmr: number,
  workActivityLevel: ActivityLevel,
  _trainingVolumeHours?: TrainingVolume,
  _trainingPlan?: TrainingPlan | null
): number {
  // Now returns pure TDEE - training calories are added per-day
  return calculateTDEE(bmr, workActivityLevel);
}

/**
 * @deprecated Use calculateBaselineCalories instead.
 */
export function calculateTargetCalories(
  tdee: number,
  currentWeightKg: number,
  goalWeightKg: number | undefined,
  goalDeadline: string | undefined,
  gender: "male" | "female" | "other"
): { calories: number; weeklyRate: number; warnings: string[] } {
  const result = calculateBaselineCalories(
    tdee,
    currentWeightKg,
    goalWeightKg,
    goalDeadline,
    gender
  );
  return {
    calories: result.baselineCalories,
    weeklyRate: result.weeklyRate,
    warnings: result.warnings,
  };
}

/**
 * Calculate macros using protein-first approach
 */
export function calculateMacros(
  calorieTarget: number,
  currentWeightKg: number,
  proteinTargetGPerKg: number,
  dietType: DietType,
  gender: "male" | "female" | "other"
): {
  proteinG: number;
  carbG: number;
  fatG: number;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Step 1: Calculate protein (always in kg)
  let proteinG = Math.round(currentWeightKg * proteinTargetGPerKg);
  const proteinCalories = proteinG * 4;

  // Validate protein isn't too low or high
  if (proteinTargetGPerKg < 1.6) {
    warnings.push(
      "Protein target is below recommended minimum (1.6g/kg). Consider increasing for better results."
    );
  } else if (proteinTargetGPerKg > 2.5) {
    warnings.push(
      "Protein target is higher than necessary (>2.5g/kg). Excess protein provides no additional benefit."
    );
  }

  // Step 2: Calculate remaining calories for carbs/fat
  const remainingCalories = calorieTarget - proteinCalories;

  if (remainingCalories < 0) {
    warnings.push(
      "Protein alone exceeds calorie target. Adjusting protein down to fit."
    );
    proteinG = Math.round((calorieTarget * 0.4) / 4);
    const adjustedProteinCalories = proteinG * 4;
    const adjustedRemainingCalories = calorieTarget - adjustedProteinCalories;

    return {
      proteinG,
      carbG: Math.round((adjustedRemainingCalories * 0.5) / 4),
      fatG: Math.round((adjustedRemainingCalories * 0.5) / 9),
      warnings,
    };
  }

  // Step 3: Determine carb/fat split based on diet type
  const dietSplits: Record<DietType, { carb: number; fat: number }> = {
    balanced: { carb: 0.5, fat: 0.5 },
    high_carb: { carb: 0.65, fat: 0.35 },
    low_carb: { carb: 0.25, fat: 0.75 },
    keto: { carb: 0.1, fat: 0.9 },
    custom: { carb: 0.5, fat: 0.5 },
  };

  const split = dietSplits[dietType];

  // Step 4: Apply gender-specific minimum fat requirements
  const minFatPercentage = gender === "female" ? 0.25 : 0.2;
  const minFatCalories = calorieTarget * minFatPercentage;

  let fatCalories = remainingCalories * split.fat;
  let carbCalories = remainingCalories * split.carb;

  // Ensure minimum fat intake
  if (fatCalories < minFatCalories) {
    warnings.push(
      `Fat intake increased to meet ${gender === "female" ? "25%" : "20%"} minimum for hormonal health.`
    );
    fatCalories = minFatCalories;
    carbCalories = remainingCalories - fatCalories;
  }

  const fatG = Math.round(fatCalories / 9);
  const carbG = Math.round(carbCalories / 4);

  return {
    proteinG,
    carbG,
    fatG,
    warnings,
  };
}

/**
 * Generate complete nutrition plan
 */
export function generateNutritionPlan(
  input: NutritionCalculationInput
): NutritionPlan {
  const warnings: string[] = [];

  // Calculate pure TDEE (BMR x activity multiplier, no training calories)
  const tdee = calculateTDEE(input.bmr, input.workActivityLevel);

  // Calculate baseline calories (TDEE - required deficit to hit goal)
  const baselineResult = calculateBaselineCalories(
    tdee,
    input.currentWeightKg,
    input.goalWeightKg,
    input.goalDeadline,
    input.gender
  );

  warnings.push(...baselineResult.warnings);

  // Calculate macros based on baseline calories
  const macroResult = calculateMacros(
    baselineResult.baselineCalories,
    input.currentWeightKg,
    input.proteinTargetGPerKg,
    input.dietType,
    input.gender
  );

  warnings.push(...macroResult.warnings);

  return {
    baselineCalories: baselineResult.baselineCalories,
    tdee,
    calorieTarget: baselineResult.baselineCalories, // Backward compat
    proteinTargetG: macroResult.proteinG,
    carbTargetG: macroResult.carbG,
    fatTargetG: macroResult.fatG,
    adjustedTdee: tdee, // Backward compat (now same as tdee)
    weeklyWeightChangeKg: baselineResult.weeklyRate,
    requiredDailyDeficit: baselineResult.requiredDailyDeficit,
    warnings,
  };
}
