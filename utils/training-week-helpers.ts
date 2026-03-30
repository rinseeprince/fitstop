const DAY_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Count training sessions planned between rangeStart and rangeEnd (inclusive).
 * Only counts sessions with sessionType "training" and a dayOfWeek assignment.
 */
export function countPlannedSessions(
  sessions: Array<{ dayOfWeek?: string; sessionType: string }>,
  rangeStart: string,
  rangeEnd: string
): number {
  const start = new Date(rangeStart + "T00:00:00");
  const end = new Date(rangeEnd + "T00:00:00");
  const scheduledDays = new Set(
    sessions
      .filter((s) => s.sessionType === "training" && s.dayOfWeek)
      .map((s) => DAY_NUM[s.dayOfWeek!.toLowerCase()])
  );
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (scheduledDays.has(cursor.getDay())) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
