import type { NutritionAdherenceStatus } from "@/types/daily-log";
import {
  NUTRITION_ADHERENCE_HIT_THRESHOLD,
  NUTRITION_ADHERENCE_PARTIAL_THRESHOLD,
} from "@/lib/constants";

/**
 * The ONE per-day nutrition verdict: what was eaten against the day's
 * computed target, hit within 50 kcal, partial within 200, else missed. Null
 * when either side is absent — a day with no target, or nothing eaten, is
 * not judged. Pure, so the kernel (`utils/nutrition-period-summary.ts`), the
 * daily-log mapper, the attention feed and the Overview rail all share it
 * without a database client in the import chain.
 */
export const calculateNutritionAdherence = (
  caloriesConsumed?: number,
  targetCalories?: number
): NutritionAdherenceStatus | null => {
  if (!caloriesConsumed || !targetCalories) return null;

  const difference = Math.abs(caloriesConsumed - targetCalories);

  if (difference <= NUTRITION_ADHERENCE_HIT_THRESHOLD) return "hit";
  if (difference <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD) return "partial";
  return "missed";
};

/** Intake minus target on a judged day; null when either side is absent. */
export const calculateCalorieSurplusDeficit = (
  caloriesConsumed?: number,
  targetCalories?: number
): number | null => {
  if (!caloriesConsumed || !targetCalories) return null;
  return caloriesConsumed - targetCalories;
};
