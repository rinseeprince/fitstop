/**
 * A day's weekday from its own YYYY-MM-DD date, parsed at local noon so the
 * weekday is stable across a DST boundary. Shared by the review's Training and
 * Nutrition cards, so their day columns cannot drift.
 */
export const dayLabel = (date: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
