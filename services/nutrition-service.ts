import type {
  TrainingVolume,
  DietType,
  NutritionWarning,
} from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import { CALORIES_PER_KG } from "@/lib/constants";
import { weeklyRateToDailyDelta, dailyDeltaToWeeklyRate } from "@/utils/energy-conversions";

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
  warnings: NutritionWarning[];
};

type NutritionCalculationInput = {
  currentWeightKg: number;
  goalWeightKg?: number;
  bmr: number;
  /** The PROFILE's TDEE. REQUIRED, and used verbatim.
   *
   *  This calculator does not derive TDEE and does not know about activity
   *  levels. `clients.work_activity_level` feeds exactly one thing — the energy
   *  helper that computes the profile pair (`computeEnergyPair`) — and this
   *  reads the result. Re-deriving it here was how a coach's custom TDEE got
   *  silently discarded: they set 4,000 and every macro was solved against
   *  1787 x 1.9 = 3,395. Two ways to obtain one number is one way too many. */
  tdee: number;
  gender: "male" | "female" | "other";
  trainingVolumeHours?: TrainingVolume; // Deprecated: kept for backward compat
  trainingPlan?: TrainingPlan | null; // Used for per-day calorie additions
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalDeadline?: string;
  startDate?: string;
  // Client-local today (the goal deadline lives on the client's calendar);
  // server-local midnight is only the fallback.
  today?: string;
};

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
  warnings: NutritionWarning[];
} {
  const warnings: NutritionWarning[] = [];

  // If no goal weight or deadline, use maintenance calories (no deficit)
  if (!goalWeightKg || !goalDeadline) {
    return {
      baselineCalories: tdee,
      requiredDailyDeficit: 0,
      weeklyRate: 0,
      warnings: [],
    };
  }

  // Calculate time to goal.
  // When the goal starts in the future, count from the goal start, not today.
  // When it already started, count from today — the CLIENT-local today when the
  // caller provides it (the deadline lives on the client's calendar);
  // server-local midnight only as fallback.
  //
  // All three dates are reduced to a calendar day and parsed as LOCAL midnight,
  // deliberately. `new Date("YYYY-MM-DD")` is UTC midnight while
  // `new Date("YYYY-MM-DDT00:00:00")` is local, so mixing the two forms put the
  // operands of the subtraction below on different clocks. That was invisible
  // while this ran only on the server (one clock), but this module is pure and
  // now also runs in the coach's BROWSER to preview a plan before it is saved —
  // and a preview that disagrees with the save is the one thing this calculator
  // must never do. Parsing everything the same way makes the arithmetic
  // identical in every zone (measured: UTC, +1, -4, -7, +5:30, +13, +14, and a
  // DST-spanning range).
  //
  // The slice(0, 10) is load-bearing, not defensive: callers pass BOTH forms.
  // Production sends date-only strings (goal_deadline is a DATE column), but
  // `new Date().toISOString()` timestamps reach here too, and appending
  // "T00:00:00" to one of those yields an Invalid Date and a silent NaN
  // baseline — NaN is not caught by the minimum-calorie floor below.
  // These are calendar dates either way; the time-of-day is not information.
  const localMidnight = (value: string) => new Date(value.slice(0, 10) + "T00:00:00");
  let now: Date;
  if (today) {
    now = localMidnight(today);
  } else {
    now = new Date();
    now.setHours(0, 0, 0, 0);
  }
  const startDate = calcStartDate
    ? new Date(Math.max(localMidnight(calcStartDate).getTime(), now.getTime()))
    : now;
  const deadline = localMidnight(goalDeadline);
  const daysToGoal = Math.round(
    (deadline.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  if (daysToGoal <= 0) {
    warnings.push({ code: "deadline_passed" });
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

  // Calculate total calorie deficit/surplus needed (CALORIES_PER_KG per kg)
  const totalCalorieChange = Math.abs(weightChangeKg) * CALORIES_PER_KG;

  // Calculate required daily deficit/surplus
  let requiredDailyChange = totalCalorieChange / daysToGoal;

  // Calculate weekly rate for display
  const weeksToGoal = daysToGoal / 7;
  let weeklyRate = weightChangeKg / weeksToGoal;

  // Gender-specific safety caps
  const maxWeeklyDeficitKg = gender === "female" ? 0.75 : 1.0;
  const maxWeeklySurplusKg = gender === "female" ? 0.35 : 0.5;

  // Cap the rate if too aggressive. The helper is signed (+ = gain); a
  // magnitude in gives a magnitude out, which is what requiredDailyChange is.
  if (isWeightLoss && weeklyRate < -maxWeeklyDeficitKg) {
    weeklyRate = -maxWeeklyDeficitKg;
    requiredDailyChange = weeklyRateToDailyDelta(maxWeeklyDeficitKg);
    warnings.push({
      code: "deficit_capped",
      maxWeeklyChangeKg: maxWeeklyDeficitKg,
    });
  } else if (!isWeightLoss && weeklyRate > maxWeeklySurplusKg) {
    weeklyRate = maxWeeklySurplusKg;
    requiredDailyChange = weeklyRateToDailyDelta(maxWeeklySurplusKg);
    warnings.push({
      code: "surplus_capped",
      maxWeeklyChangeKg: maxWeeklySurplusKg,
    });
  }

  // Calculate baseline calories
  // For weight loss: baseline = TDEE - deficit
  // For weight gain: baseline = TDEE + surplus
  // `+ 0` normalizes negative zero: a goal equal to the current weight makes
  // requiredDailyChange 0, and `-0` survives arithmetic and renders as "-0"
  // through toLocaleString. Object.is(-0 + 0, 0) is true.
  let requiredDailyDeficit = (isWeightLoss ? requiredDailyChange : -requiredDailyChange) + 0;
  let baselineCalories = Math.round(tdee - requiredDailyDeficit);

  // Ensure minimum calories. Raising the target changes the ACTUAL deficit, so
  // the returned pair must be re-derived from what the floor made true — the
  // two caps above recompute their pair, and this used to be the odd one out:
  // a floored plan rendered "TDEE 2000 · −900/day · −0.82 kg/week" beside a
  // 1500 kcal target that only implies −500/day.
  const minimumCalories = gender === "female" ? 1200 : 1500;
  if (baselineCalories < minimumCalories) {
    warnings.push({ code: "calories_raised_to_minimum", minimumCalories });
    baselineCalories = minimumCalories;
    // Legacy deficit-positive convention at this boundary; the helper is
    // signed (+ = surplus), hence the negation of (baseline − TDEE).
    requiredDailyDeficit = tdee - baselineCalories;
    weeklyRate = dailyDeltaToWeeklyRate(baselineCalories - tdee);
  }

  return {
    baselineCalories,
    requiredDailyDeficit,
    weeklyRate,
    warnings,
  };
}

/**
 * Calculate macros using protein-first approach
 */
function calculateMacros(
  calorieTarget: number,
  currentWeightKg: number,
  proteinTargetGPerKg: number,
  dietType: DietType,
  gender: "male" | "female" | "other"
): {
  proteinG: number;
  carbG: number;
  fatG: number;
  warnings: NutritionWarning[];
} {
  const warnings: NutritionWarning[] = [];

  // Step 1: Calculate protein (always in kg)
  let proteinG = Math.round(currentWeightKg * proteinTargetGPerKg);
  const proteinCalories = proteinG * 4;

  // Validate protein isn't too low or high
  if (proteinTargetGPerKg < 1.6) {
    warnings.push({ code: "protein_below_minimum" });
  } else if (proteinTargetGPerKg > 2.5) {
    warnings.push({ code: "protein_above_necessary" });
  }

  // Step 2: Calculate remaining calories for carbs/fat
  const remainingCalories = calorieTarget - proteinCalories;

  if (remainingCalories < 0) {
    warnings.push({ code: "protein_exceeds_calories" });
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
    warnings.push({ code: "fat_increased_for_minimum", gender });
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
  const warnings: NutritionWarning[] = [];

  // Used verbatim — see the type. The profile owns this number.
  const tdee = input.tdee;

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
