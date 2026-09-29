/**
 * A day's weekday from its own YYYY-MM-DD date, parsed at local noon so the
 * weekday is stable across a DST boundary. The review's week names each line's
 * day with it.
 */
export const dayLabel = (date: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
