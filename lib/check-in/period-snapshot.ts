import type { NutritionDay, PeriodSnapshot, ScheduleDay } from "@/types/schedule";

/**
 * The period snapshot a submitted check-in freezes: the day-by-day training
 * schedule and the nutrition kernel's rows, assembled once at submit from the
 * same rows the stored columns are derived from. Frozen ROWS, not figures:
 * every figure is the kernel over these rows, so nothing else needs freezing
 * and a later plan change cannot move what a submitted check-in reported.
 */
export function buildPeriodSnapshot(
  training: ScheduleDay[],
  nutrition: NutritionDay[],
  generatedAt: string = new Date().toISOString()
): PeriodSnapshot {
  return { generatedAt, training, nutrition };
}

/** The stored JSON, if it is a snapshot — a row written before the column existed carries none. */
export function readPeriodSnapshot(value: unknown): PeriodSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<PeriodSnapshot>;
  if (!Array.isArray(candidate.training) || !Array.isArray(candidate.nutrition)) return null;
  return candidate as PeriodSnapshot;
}

/**
 * The adherence denominator a submitted check-in's stored `nutrition_days_on_target`
 * was counted over: the days its frozen rows carry a target. Null without a
 * snapshot — a legacy row's count has no denominator to be shown against.
 */
export function countTargetedDays(value: unknown): number | null {
  const snapshot = readPeriodSnapshot(value);
  if (!snapshot) return null;
  return snapshot.nutrition.filter((day) => day.targetCalories != null).length;
}
