/**
 * Every calendar day's sessions, in the day's order: `day_order`, then id. A
 * day can hold several sessions (migration 179), logged or not, and each is
 * its own workout.
 *
 * The program as laid on the calendar is read through this: the plan editor
 * seeds from it and the client's Program tab lists from it, so the two show
 * the same sessions on every day, in the same order.
 */
export function sessionsByDay<T extends { id: string; date: string; day_order: number }>(
  events: T[],
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const event of events) {
    const day = byDay.get(event.date);
    if (day) day.push(event);
    else byDay.set(event.date, [event]);
  }
  for (const day of byDay.values()) {
    day.sort((a, b) => a.day_order - b.day_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return byDay;
}
