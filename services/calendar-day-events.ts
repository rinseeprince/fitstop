/**
 * The event each calendar day shows: its scheduled session when it has one,
 * else the first by id. A day holds at most one scheduled event (migration
 * 136); any other event on the date is a logged one, and the scheduled one is
 * what the day prescribes now.
 *
 * The program as laid on the calendar is read through this: the plan editor
 * seeds from it and the client's Program tab lists from it, so the two show
 * the same session on every day.
 */
export function eventByDay<T extends { id: string; date: string; status: string }>(
  events: T[],
): Map<string, T> {
  const byDay = new Map<string, T>();
  for (const event of events) {
    const held = byDay.get(event.date);
    if (!held || outranks(event, held)) byDay.set(event.date, event);
  }
  return byDay;
}

function outranks(
  candidate: { id: string; status: string },
  held: { id: string; status: string },
): boolean {
  const candidateScheduled = candidate.status === "scheduled";
  const heldScheduled = held.status === "scheduled";
  if (candidateScheduled !== heldScheduled) return candidateScheduled;
  return candidate.id < held.id;
}
