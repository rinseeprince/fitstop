import type {
  Client,
  ActivityLevel,
  TrainingVolume,
  DietType,
} from "@/types/check-in";
import {
  getActivityMultiplier,
  getTrainingCalories,
  weightToKg,
} from "@/utils/nutrition-helpers";

export type NutritionPlan = {
  calorieTarget: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  adjustedTdee: number;
  weeklyWeightChangeKg: number;
  warnings: string[];
};

export type NutritionCalculationInput = {
  currentWeightKg: number;
  goalWeightKg?: number;
  bmr: number;
  tdee: number;
  gender: "male" | "female" | "other";
  workActivityLevel: ActivityLevel;
  trainingVolumeHours: TrainingVolume;
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalDeadline?: string;
  weightUnit: "lbs" | "kg";
};

/**
 * Calculate adjusted TDEE based on activity and training
 */
export function calculateAdjustedTDEE(
  bmr: number,
  workActivityLevel: ActivityLevel,
  trainingVolumeHours: TrainingVolume
): number {
  const activityMultiplier = getActivityMultiplier(workActivityLevel);
  const trainingCalories = getTrainingCalories(trainingVolumeHours);

  return Math.round(bmr * activityMultiplier + trainingCalories);
}

/**
 * Calculate target calories based on goal and timeline
 */
export function calculateTargetCalories(
  adjustedTdee: number,
  currentWeightKg: number,
  goalWeightKg: number | undefined,
  goalDeadline: string | undefined,
  gender: "male" | "female" | "other"
): { calories: number; weeklyRate: number; warnings: string[] } {
  const warnings: string[] = [];

  // If no goal weight or deadline, use maintenance calories
  if (!goalWeightKg || !goalDeadline) {
    return {
      calories: adjustedTdee,
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
      calories: adjustedTdee,
      weeklyRate: 0,
      warnings,
    };
  }

  // Calculate weight to lose/gain
  const weightChangeKg = goalWeightKg - currentWeightKg;
  const isWeightLoss = weightChangeKg < 0;

  // Calculate weekly rate needed
  const weeksToGoal = daysToGoal / 7;
  const weeklyRateNeeded = weightChangeKg / weeksToGoal;

  // Gender-specific safety caps
  const maxWeeklyDeficitKg = gender === "female" ? 0.75 : 1.0;
  const maxWeeklySurplusKg = gender === "female" ? 0.35 : 0.5;

  let weeklyRate = weeklyRateNeeded;

  // Cap the rate if too aggressive
  if (isWeightLoss && weeklyRateNeeded < -maxWeeklyDeficitKg) {
    weeklyRate = -maxWeeklyDeficitKg;
    warnings.push(
      `Weekly deficit capped at ${maxWeeklyDeficitKg}kg/week for safety. Goal timeline may need adjustment.`
    );
  } else if (!isWeightLoss && weeklyRateNeeded > maxWeeklySurplusKg) {
    weeklyRate = maxWeeklySurplusKg;
    warnings.push(
      `Weekly surplus capped at ${maxWeeklySurplusKg}kg/week for optimal muscle gain. Goal timeline may need adjustment.`
    );
  }

  // Calculate calorie adjustment (1kg = 7700 calories)
  const dailyCalorieAdjustment = (weeklyRate * 7700) / 7;
  const targetCalories = Math.round(adjustedTdee + dailyCalorieAdjustment);

  // Ensure minimum calories
  const minimumCalories = gender === "female" ? 1200 : 1500;
  if (targetCalories < minimumCalories) {
    warnings.push(
      `Calorie target raised to minimum safe level (${minimumCalories} cal/day). Consider adjusting goal timeline.`
    );
    return {
      calories: minimumCalories,
      weeklyRate,
      warnings,
    };
  }

  return {
    calories: targetCalories,
    weeklyRate,
    warnings,
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
    proteinG = Math.round((calorieTarget * 0.4) / 4); // Cap protein at 40% of calories
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
    custom: { carb: 0.5, fat: 0.5 }, // Default to balanced for custom
  };

  let split = dietSplits[dietType];

  // Step 4: Apply gender-specific minimum fat requirements
  const minFatPercentage = gender === "female" ? 0.25 : 0.2;
  const minFatCalories = calorieTarget * minFatPercentage;
  const minFatG = Math.ceil(minFatCalories / 9);

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

  // Calculate adjusted TDEE
  const adjustedTdee = calculateAdjustedTDEE(
    input.bmr,
    input.workActivityLevel,
    input.trainingVolumeHours
  );

  // Calculate target calories
  const calorieResult = calculateTargetCalories(
    adjustedTdee,
    input.currentWeightKg,
    input.goalWeightKg,
    input.goalDeadline,
    input.gender
  );

  warnings.push(...calorieResult.warnings);

  // Calculate macros
  const macroResult = calculateMacros(
    calorieResult.calories,
    input.currentWeightKg,
    input.proteinTargetGPerKg,
    input.dietType,
    input.gender
  );

  warnings.push(...macroResult.warnings);

  return {
    calorieTarget: calorieResult.calories,
    proteinTargetG: macroResult.proteinG,
    carbTargetG: macroResult.carbG,
    fatTargetG: macroResult.fatG,
    adjustedTdee,
    weeklyWeightChangeKg: calorieResult.weeklyRate,
    warnings,
  };
}
