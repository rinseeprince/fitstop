import { HABIT_AMOUNT_MAX, HABIT_AMOUNT_PATTERN } from "@/lib/constants";

/**
 * A habit number typed into a box — a coach's target, a client's entry: zero
 * or more, to two decimals at most, what the habit routes accept
 * (NUMERIC(10,2)). Read as typed, never converted: a habit's unit is the
 * coach's word. The reason in plain words when it is not one; an empty box is
 * the caller's to judge before it asks.
 */
export function parseHabitAmount(text: string): { value: number } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { error: "Enter a number" };
  if (!HABIT_AMOUNT_PATTERN.test(trimmed)) return { error: "Enter a number, to two decimals at most" };
  const value = Number(trimmed);
  if (value > HABIT_AMOUNT_MAX) return { error: `Enter at most ${HABIT_AMOUNT_MAX.toLocaleString("en-GB")}` };
  return { value };
}
