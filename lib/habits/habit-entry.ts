import type { HabitAnswer, HabitDirection, HabitEntry, HabitMeasure } from "@/types/habits";

/**
 * Whether an entry is met (docs/HABITS-REBUILD-PLAN.md §2.2, rule 5) — worked
 * out when asked, never stored. A tick habit's entry is met when done; a
 * number habit's when its number meets the day's target in the habit's
 * direction. Because a version is never edited once its first day has passed,
 * and one-date edits reach today onward only, the day's target is the one the
 * day had, so an entry is judged the same way forever.
 */

const MEASURES: readonly HabitMeasure[] = ["tick", "number"];
const DIRECTIONS: readonly HabitDirection[] = ["at_least", "at_most"];

export function isHabitMeasure(value: string): value is HabitMeasure {
  return (MEASURES as readonly string[]).includes(value);
}

export function isHabitDirection(value: string): value is HabitDirection {
  return (DIRECTIONS as readonly string[]).includes(value);
}

/** Whether the entry meets the day's target, in the habit's direction. */
export function entryMet(
  habit: { measure: HabitMeasure; direction: HabitDirection | null },
  entry: Pick<HabitEntry, "done" | "value">,
  target: number | null
): boolean {
  if (habit.measure === "tick") return entry.done === true;
  if (entry.value === null || target === null) return false;
  if (habit.direction === "at_least") return entry.value >= target;
  if (habit.direction === "at_most") return entry.value <= target;
  return false;
}

/** Why an answer does not fit how the habit is measured, or null when it does. */
export function answerMismatch(measure: HabitMeasure, answer: HabitAnswer): "expects_tick" | "expects_number" | null {
  if (measure === "tick") return "done" in answer ? null : "expects_tick";
  return "value" in answer ? null : "expects_number";
}
