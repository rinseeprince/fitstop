import type {
  ActivityLevel,
  TrainingVolume,
  DietType,
} from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import {
  getActivityMultiplier,
} from "@/utils/nutrition-helpers";
import { CALORIES_PER_KG } from "@/lib/constants";
import {
  applyCalorieFloor,
  capWeeklyRate,
  dailyCalorieMagnitudeFromRate,
  daysToDeadline,
} from "@/lib/goals/goal-rate";
import { getTodayDateString } from "@/lib/date-helpers";

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
  startDate?: string;
  // Client-local today (the goal deadline lives on the client's calendar);
  // server-local midnight is only the fallback.
  today?: string;
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
 * Narrow a date-ish string to its calendar date.
 *
 * `calculateBaselineCalories` accepts either a bare `YYYY-MM-DD` — what every
 * production caller passes, since `goal_deadline` and `goal_start_date` are DATE
 * columns — or a full ISO timestamp, which its tests pass and which the old
 * `new Date(...)` parsing silently tolerated. Day-number arithmetic needs the
 * calendar date, and slicing an ISO string yields its UTC date, which is exactly
 * how the previous `new Date(iso)` comparison already read it.
 */
function toCalendarDate(value: string): string {
  return value.slice(0, 10);
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
  gender: "male" | "female" | "other",
  calcStartDate?: string,
  today?: string
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

  // Calculate time to goal. A start date in the future counts from the start;
  // one already elapsed counts from today — the CLIENT-local today when the
  // caller provides it (the deadline lives on the client's calendar), with
  // server-local as the only fallback. The count includes both endpoints.
  //
  // DAY-NUMBER arithmetic, deliberately not Date math. This block used to parse
  // `today` as LOCAL midnight while `goalDeadline` — a bare DATE from PostgREST
  // — parsed as UTC midnight, and the `Math.round` absorbed the offset only
  // below ±12h. Measured in task 1.4: correct at UTC / Los Angeles / São Paulo /
  // Kolkata, wrong at Auckland and Kiritimati (92 vs 91), and wrong by two at
  // exactly +12 where the fraction is 0.5 and rounds up. Latent while both
  // callers were server-side under UTC Node — but Session 3 renders this
  // arithmetic in the coach's browser, which would make it live for every coach
  // at ≥+12, silently and always in the "too slow" direction.
  //
  // `daysToDeadline` is the shared implementation task 1.4 pinned across six
  // zones, so the two cannot drift apart again.
  const daysToGoal = daysToDeadline({
    deadline: toCalendarDate(goalDeadline),
    today: toCalendarDate(today ?? getTodayDateString()),
    startDate: calcStartDate ? toCalendarDate(calcStartDate) : undefined,
  });

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

  // Calculate total calorie deficit/surplus needed
  const totalCalorieChange = Math.abs(weightChangeKg) * CALORIES_PER_KG;

  // Calculate required daily deficit/surplus
  let requiredDailyChange = totalCalorieChange / daysToGoal;

  // Calculate weekly rate for display
  const weeksToGoal = daysToGoal / 7;
  let weeklyRate = weightChangeKg / weeksToGoal;

  // Cap the rate if too aggressive. The envelope and the warning copy live in
  // lib/goals/goal-rate.ts so the rate-FIRST entry point (which a block hands a
  // rate directly) cannot drift from this one on what counts as safe.
  const cap = capWeeklyRate(weeklyRate, gender);
  if (cap.capped) {
    weeklyRate = cap.rateKgPerWeek;
    requiredDailyChange = dailyCalorieMagnitudeFromRate(cap.rateKgPerWeek);
    if (cap.warning) warnings.push(cap.warning);
  }

  // Calculate baseline calories
  // For weight loss: baseline = TDEE - deficit
  // For weight gain: baseline = TDEE + surplus
  const requiredDailyDeficit = isWeightLoss ? requiredDailyChange : -requiredDailyChange;

  // Ensure minimum calories.
  // NOTE: `requiredDailyDeficit` and `weeklyRate` are deliberately NOT re-derived
  // when the floor bites, so a floored result reports the deficit it was ASKED
  // for rather than the smaller one it will run. Pinned by
  // nutrition-service.caps-floor.test.ts; the rate-first entry point reports an
  // `appliedRateKgPerWeek` instead. Changing it here would move coach-visible
  // numbers, which is not this workstream's job.
  const floorResult = applyCalorieFloor(
    Math.round(tdee - requiredDailyDeficit),
    gender
  );
  if (floorResult.warning) warnings.push(floorResult.warning);

  return {
    baselineCalories: floorResult.calories,
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
    input.gender,
    input.startDate,
    input.today
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
